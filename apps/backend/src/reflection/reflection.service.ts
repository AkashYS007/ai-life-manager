import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicClient } from '../planner/anthropic-client';
import { DailyReflection } from './models/daily-reflection.model';
import { SubmitDailyReflectionInput } from './dto/submit-daily-reflection.input';

interface StoredAnswers {
  wentWell: string;
  challenging: string;
  carryForward: string;
}

// Same "get date-only math right with a well-tested tool, anchored to the
// user's own calendar day" reasoning as signals.service.ts's own
// (unexported, duplicated here rather than shared — see that file) toDateOnly.
function toDateOnly(instant: Date, timezone: string): Date {
  const isoDate = DateTime.fromJSDate(instant, { zone: timezone }).toISODate();
  return new Date(isoDate!);
}

function toGraphReflection(record: any): DailyReflection {
  return {
    id: record.id,
    date: record.date,
    answers: record.answers as StoredAnswers,
    aiSummary: record.aiSummary ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

@Injectable()
export class ReflectionService {
  private readonly logger = new Logger(ReflectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicClient,
    // Same event-based decoupling every other auto-replan trigger source
    // uses (see planner.service.ts) — PlannerModule doesn't import
    // ReflectionModule today, so there's no actual circularity risk here,
    // but the same shape is used anyway for consistency across every
    // trigger source in this app.
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getToday(userId: string, timezone: string): Promise<DailyReflection | null> {
    const date = toDateOnly(new Date(), timezone);
    const record = await this.prisma.dailyReflection.findUnique({
      where: { userId_date: { userId, date } },
    });
    return record ? toGraphReflection(record) : null;
  }

  // Bounded, most-recent-first — same "naturally bounded, no need for Relay
  // pagination yet" reasoning as FocusService.listRecent: nobody
  // accumulates more than one reflection a day, so even years of daily use
  // is a small number of rows compared to something like calendar events.
  async listRecent(userId: string, take = 14): Promise<DailyReflection[]> {
    const records = await this.prisma.dailyReflection.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take,
    });
    return records.map(toGraphReflection);
  }

  // One reflection per (user, local calendar day) — submitting again for
  // today corrects that day's answers rather than duplicating, same
  // upsert-by-date pattern SignalsService.logSleep already uses. The AI
  // summary is regenerated on every submit (including a same-day
  // correction), since a corrected answer should produce a summary that
  // actually reflects it, not a stale one from the first submission.
  async submit(userId: string, timezone: string, input: SubmitDailyReflectionInput): Promise<DailyReflection> {
    const date = toDateOnly(new Date(), timezone);
    const answers: StoredAnswers = {
      wentWell: input.wentWell,
      challenging: input.challenging,
      carryForward: input.carryForward,
    };

    let aiSummary: string | undefined;
    if (this.anthropic.isConfigured()) {
      try {
        const system =
          "You are summarizing someone's end-of-day reflection for a personal life-planning app. Write one warm, specific, encouraging sentence or two — not generic productivity-coach language — that reflects what they actually wrote. Do not invent details they didn't mention.";
        const prompt = `What went well today: ${input.wentWell}\nWhat was challenging: ${input.challenging}\nWhat they want to carry into tomorrow: ${input.carryForward}`;
        const { content } = await this.anthropic.sendMessage([{ role: 'user', content: prompt }], system);
        aiSummary = content;
      } catch (error) {
        // Best-effort, same reasoning as the swallowed per-task-schedule
        // errors in planner.service.ts's ACCEPT branch and the
        // auto-memory-learning call in respondToPlanRun — a summary failure
        // must never block saving the actual reflection the person is
        // waiting on.
        this.logger.warn(`Daily reflection AI summary failed: ${(error as Error).message}`);
      }
    }

    // Note: if this is a same-day resubmit and the AI call above failed,
    // `aiSummary` is `undefined` here — Prisma treats an undefined value in
    // `update` as "leave this column alone," so a transient AI failure on a
    // correction doesn't wipe out a summary that was already generated
    // successfully the first time. It may then read slightly stale against
    // the corrected answers until the next successful summary, a deliberate
    // "don't destroy something that has value over a transient failure"
    // tradeoff, not an oversight.
    const record = await this.prisma.dailyReflection.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        answers: answers as any,
        aiSummary,
      },
      update: {
        answers: answers as any,
        aiSummary,
      },
    });

    // Further auto-replanning triggers increment — fires on a same-day
    // resubmit/correction too, not just the first submission of the day;
    // same "don't special-case a re-completion" reasoning
    // `HabitsService.completeLog`'s own trigger already uses — the
    // per-scope cooldown in `maybeAutoReplan` is what keeps repeated
    // submissions from being noisy, not anything checked here.
    this.eventEmitter.emit('reflection.submitted', { userId });

    return toGraphReflection(record);
  }
}
