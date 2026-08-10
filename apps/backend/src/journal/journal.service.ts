import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicClient } from '../planner/anthropic-client';
import { MemoryService } from '../memory/memory.service';
import { JournalEntry } from './models/journal-entry.model';
import { CreateJournalEntryInput } from './dto/create-journal-entry.input';
import { UpdateJournalEntryInput } from './dto/update-journal-entry.input';

@Injectable()
export class JournalService {
  private readonly logger = new Logger(JournalService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Same event-based decoupling every other auto-replan trigger source
    // uses (see planner.service.ts) — PlannerModule doesn't import
    // JournalModule today, so there's no actual circularity risk here, but
    // the same shape is used anyway for consistency across every trigger
    // source in this app.
    private readonly eventEmitter: EventEmitter2,
    // Journal sentiment analysis increment.
    private readonly anthropic: AnthropicClient,
    private readonly memoryService: MemoryService,
  ) {}

  private async requireOwnedEntry(userId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({ where: { id, userId } });
    if (!entry) {
      throw new NotFoundException('Journal entry not found');
    }
    return entry;
  }

  // Same cursor-connection shape as TasksService.listConnection /
  // CalendarService.listConnection — most-recent-first, since a journal is
  // read like a diary (newest entry first), not chronologically forward.
  async listConnection(
    userId: string,
    args: { first?: number; after?: string },
  ): Promise<{ edges: { cursor: string; node: JournalEntry }[]; pageInfo: any }> {
    const take = Math.min(args.first ?? 20, 100);
    const records = await this.prisma.journalEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }],
      take: take + 1,
      ...(args.after ? { cursor: { id: args.after }, skip: 1 } : {}),
    });

    const hasNextPage = records.length > take;
    const page = records.slice(0, take);
    const edges = page.map((r) => ({ cursor: r.id, node: r as unknown as JournalEntry }));

    return {
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: !!args.after,
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
      },
    };
  }

  async create(userId: string, input: CreateJournalEntryInput): Promise<JournalEntry> {
    const record = await this.prisma.journalEntry.create({
      data: { userId, content: input.content },
    });

    // Journal sentiment analysis increment — closes the "journal sentiment
    // feeds mood inference" gap the README used to name under "not built
    // yet." Best-effort, same "a learning/enhancement computation must
    // never break the core action the user is waiting on" principle as
    // every other automatic-learning trigger in this app (see
    // FocusService.complete's own refreshChronotypePattern call): a failed
    // or skipped sentiment score just leaves this one entry's
    // sentimentScore null, exactly as if AI scoring had never been built.
    //
    // Deliberately NOT awaited: this entry is already saved and returned to
    // the person the instant the line above finishes — a real call to a
    // third-party AI API can take anywhere from under a second to well over
    // 30 (this is what was actually blocking every "writing an entry..."
    // e2e run: the Save button stayed disabled and the entry never appeared
    // for the whole 30s test timeout, because the mutation itself hadn't
    // resolved yet). Scoring now happens in the background and lands on
    // this same row a few seconds later, visible on the next poll/reload —
    // exactly the same "arrives a little after the fact" timing this app
    // already accepts for chronotype pattern refreshes and other automatic-
    // learning triggers, just made real here instead of accidentally
    // blocking the save it's attached to.
    if (this.anthropic.isConfigured()) {
      void this.scoreSentimentInBackground(userId, record.id, input.content);
    }

    // Further auto-replanning triggers increment — a *new* entry only, not
    // an edit (`update` below doesn't emit this) — same "a fresh signal,
    // not a correction to an old one" distinction `logSleep` already
    // implicitly draws by not triggering anything at all; writing a journal
    // entry is the closest thing this app has to "something changed in how
    // today's actually going" from Journal specifically.
    this.eventEmitter.emit('journal.entryCreated', { userId });
    return record as unknown as JournalEntry;
  }

  private async scoreSentimentInBackground(userId: string, entryId: string, content: string): Promise<void> {
    let sentimentScore: number | null = null;
    try {
      const { score } = await this.anthropic.analyzeSentiment(content);
      sentimentScore = score;
      await this.prisma.journalEntry.update({
        where: { id: entryId },
        data: { sentimentScore: score },
      });
    } catch (error) {
      this.logger.warn(`Journal sentiment scoring failed: ${(error as Error).message}`);
      return;
    }

    // Refreshing the aggregate trend fact only makes sense once this entry
    // actually has a real score to contribute.
    if (sentimentScore !== null) {
      try {
        await this.memoryService.refreshJournalSentimentPattern(userId);
      } catch (error) {
        this.logger.warn(`Journal sentiment pattern refresh failed: ${(error as Error).message}`);
      }
    }
  }

  async update(userId: string, id: string, input: UpdateJournalEntryInput): Promise<JournalEntry> {
    await this.requireOwnedEntry(userId, id);
    const record = await this.prisma.journalEntry.update({
      where: { id },
      data: { content: input.content },
    });
    return record as unknown as JournalEntry;
  }

  async delete(userId: string, id: string): Promise<string> {
    await this.requireOwnedEntry(userId, id);
    await this.prisma.journalEntry.delete({ where: { id } });
    return id;
  }

  // Insights: journal activity increment — same lightweight, unhydrated
  // query as TasksService/FocusService's own analytics helpers; only
  // `createdAt` is needed to bucket an entry into a local calendar day.
  async listCreatedInRange(userId: string, fromDate: Date, toDate: Date): Promise<Array<{ createdAt: Date }>> {
    return this.prisma.journalEntry.findMany({
      where: { userId, createdAt: { gte: fromDate, lte: toDate } },
      select: { createdAt: true },
    }) as unknown as Promise<Array<{ createdAt: Date }>>;
  }
}
