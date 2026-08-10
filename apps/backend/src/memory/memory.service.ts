import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { AiMemoryFact } from './models/memory-fact.model';

const FACT_TYPE = 'preference'; // the only fact_type the manual CRUD API (create/update/delete, and the /memory page's list) reads or writes
// Fact types injected into the AI planner/chat prompt as context, on top of
// manually-created preferences — see refreshInterventionResponsePattern
// below for where 'intervention_response' facts actually get written.
// Deliberately NOT surfaced on the /memory page (which stays 'preference'
// only) to keep that manual-editing UI free of auto-generated technical
// facts — a known, documented gap, not an oversight.
// Journal sentiment analysis increment adds 'journal_sentiment' — see
// refreshJournalSentimentPattern below for where it's actually written.
const CONTEXT_FACT_TYPES = ['preference', 'intervention_response', 'task_duration_accuracy', 'chronotype', 'journal_sentiment'];

const MIN_PLAN_RESPONSES_FOR_PATTERN = 3;
const PLAN_RESPONSE_SAMPLE_SIZE = 10;

const MIN_DURATION_SAMPLES_FOR_PATTERN = 3;
const DURATION_SAMPLE_SIZE = 10;

const MIN_ENERGY_SAMPLES_FOR_CHRONOTYPE = 5;
const MIN_FOCUS_SESSIONS_FOR_CHRONOTYPE = 3;
const CHRONOTYPE_SAMPLE_SIZE = 30;

// Journal sentiment analysis increment. Same "don't manufacture a fact from
// noise" sample-size discipline as every other automatic-learning signal
// above/below — a single very-negative or very-positive entry isn't a
// "trend," it's one moment. 0.3 (on JournalEntry.sentimentScore's own -1 to
// 1 scale — see AnthropicClient.analyzeSentiment) is a deliberately
// moderate bar: strong enough that a genuinely mixed run of entries stays
// silent, not so strict that a real, sustained trend goes unnoticed.
const MIN_JOURNAL_SENTIMENT_SAMPLES = 3;
const JOURNAL_SENTIMENT_SAMPLE_SIZE = 10;
const JOURNAL_SENTIMENT_TREND_THRESHOLD = 0.3;

type Daypart = 'MORNING' | 'AFTERNOON' | 'EVENING';
const DAYPARTS: Daypart[] = ['MORNING', 'AFTERNOON', 'EVENING'];

// 0am-5am ("late night") is deliberately excluded from every bucket below —
// too sparse and too unusual an hour for anyone's normal pattern to draw a
// real conclusion from, same "don't manufacture a fact from noise"
// discipline the rest of this file already applies.
function daypartForHour(hour: number): Daypart | null {
  if (hour >= 5 && hour < 12) return 'MORNING';
  if (hour >= 12 && hour < 18) return 'AFTERNOON';
  if (hour >= 18 && hour < 24) return 'EVENING';
  return null;
}

interface StoredValue {
  text: string;
}

function toGraphFact(record: any): AiMemoryFact {
  const value = record.value as StoredValue;
  return {
    id: record.id,
    content: value.text,
    confidence: record.confidence,
    updatedAt: record.updatedAt,
  };
}

@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireOwnedFact(userId: string, id: string) {
    const fact = await this.prisma.aiMemoryFact.findFirst({ where: { id, userId } });
    if (!fact) {
      throw new NotFoundException('Memory fact not found');
    }
    return fact;
  }

  async listForUser(userId: string): Promise<AiMemoryFact[]> {
    const records = await this.prisma.aiMemoryFact.findMany({
      where: { userId, factType: FACT_TYPE },
      orderBy: { updatedAt: 'desc' },
    });
    return records.map(toGraphFact);
  }

  async create(userId: string, content: string): Promise<AiMemoryFact> {
    const record = await this.prisma.aiMemoryFact.create({
      data: {
        userId,
        factType: FACT_TYPE,
        key: randomUUID(),
        value: ({ text: content } satisfies StoredValue) as any, // Prisma's Json input type — see planner.service.ts's `diff: diff as any` for the same reasoning
        confidence: 1.0,
      },
    });
    return toGraphFact(record);
  }

  // Re-enter onboarding increment. A real duplication bug turned up while
  // building that feature: OnboardingService.complete used to call plain
  // `create` above for the "biggest source of overload" answer — `create`
  // always generates a fresh random `key`, so redoing the quiz and
  // re-answering this question would pile up a second, third, fourth...
  // "Biggest current source of overload (from onboarding): ..." fact on
  // `/memory` every time, rather than updating the one already there. This
  // is the fix: a stable, well-known `key` (`'onboarding_overload_source'`)
  // just for this one fact, upserted instead of blindly created — the same
  // `userId_factType_key` compound-unique lookup `refreshInterventionResponsePattern`/
  // `refreshTaskDurationAccuracyPattern`/`refreshChronotypePattern` below
  // already use for their own auto-generated facts, just with `factType:
  // 'preference'` (this one still shows up on `/memory`'s manual-editing
  // list — see `FACT_TYPE`'s own comment — unlike those three). A person
  // who's manually edited or deleted this fact from `/memory` since
  // completing onboarding isn't fought with: editing it there changes its
  // `value` in place, which onboarding will then overwrite the next time
  // the quiz is redone (expected — the quiz is the source of truth for
  // this specific answer), and deleting it just means the next redo's
  // `create` branch recreates it fresh, exactly as if this were the first
  // time.
  private static readonly ONBOARDING_OVERLOAD_FACT_KEY = 'onboarding_overload_source';

  async upsertOnboardingOverloadFact(userId: string, overloadSource: string): Promise<AiMemoryFact> {
    const content = `Biggest current source of overload (from onboarding): ${overloadSource}`;
    const record = await this.prisma.aiMemoryFact.upsert({
      where: {
        userId_factType_key: {
          userId,
          factType: FACT_TYPE,
          key: MemoryService.ONBOARDING_OVERLOAD_FACT_KEY,
        },
      },
      create: {
        userId,
        factType: FACT_TYPE,
        key: MemoryService.ONBOARDING_OVERLOAD_FACT_KEY,
        value: ({ text: content } satisfies StoredValue) as any,
        confidence: 1.0,
      },
      update: {
        value: ({ text: content } satisfies StoredValue) as any,
      },
    });
    return toGraphFact(record);
  }

  // Diagnostic quiz free-text answers increment: the exact same stable-key
  // upsert shape as upsertOnboardingOverloadFact just above (see that
  // method's own comment for why upsert-by-known-key rather than a blind
  // create) — a second, independent onboarding answer, its own fact so it
  // never overwrites or gets overwritten by the overload-source one.
  private static readonly ONBOARDING_FREE_TEXT_FACT_KEY = 'onboarding_free_text';

  async upsertOnboardingFreeTextFact(userId: string, freeText: string): Promise<AiMemoryFact> {
    const content = `Additional context from onboarding: ${freeText}`;
    const record = await this.prisma.aiMemoryFact.upsert({
      where: {
        userId_factType_key: {
          userId,
          factType: FACT_TYPE,
          key: MemoryService.ONBOARDING_FREE_TEXT_FACT_KEY,
        },
      },
      create: {
        userId,
        factType: FACT_TYPE,
        key: MemoryService.ONBOARDING_FREE_TEXT_FACT_KEY,
        value: ({ text: content } satisfies StoredValue) as any,
        confidence: 1.0,
      },
      update: {
        value: ({ text: content } satisfies StoredValue) as any,
      },
    });
    return toGraphFact(record);
  }

  async update(userId: string, id: string, content: string): Promise<AiMemoryFact> {
    await this.requireOwnedFact(userId, id);
    const record = await this.prisma.aiMemoryFact.update({
      where: { id },
      data: { value: ({ text: content } satisfies StoredValue) as any },
    });
    return toGraphFact(record);
  }

  async delete(userId: string, id: string): Promise<string> {
    await this.requireOwnedFact(userId, id);
    await this.prisma.aiMemoryFact.delete({ where: { id } });
    return id;
  }

  // The whole point of this increment: a formatted block the AI planner and
  // chat both inject into their prompts, so a stated preference like "never
  // schedule calls before 10am" actually changes the AI's behavior rather
  // than just sitting in a database. Returns '' (not a placeholder string)
  // when the person hasn't told the AI anything yet, so callers can decide
  // whether to include a section at all — an honest empty state, same
  // principle as every other "nothing here yet" case in this app.
  async buildContextBlock(userId: string): Promise<string> {
    const records = await this.prisma.aiMemoryFact.findMany({
      where: { userId, factType: { in: CONTEXT_FACT_TYPES } },
      orderBy: { updatedAt: 'desc' },
    });
    if (records.length === 0) return '';
    return records.map((r) => `- ${(r.value as unknown as StoredValue).text}`).join('\n');
  }

  // Automatic learning — the simple, statistical version, not the PRD's
  // full ML/embeddings vision (see README for why that's a separate,
  // bigger project). Recomputed every time a plan run gets a real response
  // (planner.service.ts calls this from respondToPlanRun, best-effort), so
  // the pattern stays current without any background job or cron. Only
  // writes a fact when there's a clear, actionable pattern — a majority
  // reject rate, or a clean 100% accept rate over enough samples. A
  // middling rate that isn't clearly one or the other has nothing useful to
  // say, so this deliberately writes nothing rather than manufacturing a
  // vague fact just to have one.
  async refreshInterventionResponsePattern(userId: string): Promise<void> {
    const recentRuns = await this.prisma.aiPlanRun.findMany({
      where: { userId, status: { in: ['ACCEPTED', 'REJECTED'] } },
      orderBy: { respondedAt: 'desc' },
      take: PLAN_RESPONSE_SAMPLE_SIZE,
      select: { status: true },
    });

    if (recentRuns.length < MIN_PLAN_RESPONSES_FOR_PATTERN) return;

    const rejectedCount = recentRuns.filter((r) => r.status === 'REJECTED').length;
    const rejectRate = rejectedCount / recentRuns.length;

    let content: string | null = null;
    if (rejectRate >= 0.5) {
      content = `Often rejects proposed daily plans (${rejectedCount} of the last ${recentRuns.length}) — favor lighter, more conservative scheduling suggestions rather than packing the day full.`;
    } else if (rejectedCount === 0) {
      content = `Consistently accepts proposed daily plans (all of the last ${recentRuns.length}) — the current scheduling approach is working well, no need to hold back on suggestions.`;
    }

    if (!content) return; // moderate, unremarkable rate — nothing actionable to record

    await this.prisma.aiMemoryFact.upsert({
      where: {
        userId_factType_key: { userId, factType: 'intervention_response', key: 'plan_accept_reject_pattern' },
      },
      create: {
        userId,
        factType: 'intervention_response',
        key: 'plan_accept_reject_pattern',
        value: ({ text: content } satisfies StoredValue) as any,
        confidence: 1.0,
      },
      update: { value: ({ text: content } satisfies StoredValue) as any },
    });
  }

  // The second of the two "reserved but not built" §9 signals this README
  // used to call out — closed by the Task duration estimation increment,
  // which is what finally makes both estimatedDurationMinutes AND
  // actualDurationMinutes get set by a real screen (task creation's AI
  // estimate, and completion's actual-time prompt). Same statistical
  // shape as refreshInterventionResponsePattern: recomputed best-effort
  // every time a task completes with a real actual duration
  // (tasks.service.ts's complete()), only writes a fact when the pattern is
  // clear enough to be useful, and reads only the most recent
  // DURATION_SAMPLE_SIZE completions so an old, since-corrected habit
  // doesn't linger forever.
  async refreshTaskDurationAccuracyPattern(userId: string): Promise<void> {
    const recentTasks = await this.prisma.task.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        estimatedDurationMinutes: { not: null },
        actualDurationMinutes: { not: null },
      },
      orderBy: { completedAt: 'desc' },
      take: DURATION_SAMPLE_SIZE,
      select: { estimatedDurationMinutes: true, actualDurationMinutes: true },
    });

    if (recentTasks.length < MIN_DURATION_SAMPLES_FOR_PATTERN) return;

    const ratios = recentTasks.map((t) => t.actualDurationMinutes! / t.estimatedDurationMinutes!);
    const avgRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;

    let content: string | null = null;
    if (avgRatio >= 1.3) {
      content = `Tasks tend to take about ${avgRatio.toFixed(1)}x longer than estimated, based on the last ${recentTasks.length} completed tasks with both an estimate and an actual time logged — pad duration estimates for this person accordingly rather than taking a stated estimate at face value.`;
    } else if (avgRatio <= 0.8) {
      content = `Tasks tend to finish in about ${avgRatio.toFixed(1)}x the estimated time, based on the last ${recentTasks.length} completed tasks with both an estimate and an actual time logged — this person tends to overestimate, so duration estimates can run tighter than they first seem.`;
    }

    if (!content) return; // close to 1x — an accurate self-estimator, nothing actionable to record

    await this.prisma.aiMemoryFact.upsert({
      where: {
        userId_factType_key: { userId, factType: 'task_duration_accuracy', key: 'estimate_accuracy_pattern' },
      },
      create: {
        userId,
        factType: 'task_duration_accuracy',
        key: 'estimate_accuracy_pattern',
        value: ({ text: content } satisfies StoredValue) as any,
        confidence: 1.0,
      },
      update: { value: ({ text: content } satisfies StoredValue) as any },
    });
  }

  // The third and last of the PRD §9 AI Memory signals this README used to
  // list as "not built yet" — and the one the PRD is most explicit about:
  // chronotype must be "learned empirically, not just self-reported."
  // Self-reported energy check-ins alone wouldn't satisfy that (a person's
  // own guess about when they're sharpest is still self-report, however
  // timestamped), so this deliberately requires two independent signals to
  // agree before writing anything: *when* energy check-ins score highest,
  // and *when* focus sessions actually get completed (a real, own-choice,
  // finished-a-real-block-of-deep-work behavioral signal, not a survey
  // answer). Only a daypart both signals agree on gets written — same
  // "don't manufacture a fact from a coin-flip margin" discipline as
  // refreshInterventionResponsePattern and refreshTaskDurationAccuracyPattern
  // above; if the two disagree, or there isn't enough of either kind of
  // data yet, this writes nothing rather than guessing. Best-effort,
  // triggered from FocusService.complete() (see that file) right when a
  // completed session gives this fresh data to compute from — same trigger
  // shape as every other automatic-learning refresh in this app.
  async refreshChronotypePattern(userId: string, timezone: string): Promise<void> {
    const [energyEntries, completedFocusSessions] = await Promise.all([
      this.prisma.energyEntry.findMany({
        where: { userId },
        orderBy: { loggedAt: 'desc' },
        take: CHRONOTYPE_SAMPLE_SIZE,
        select: { energyScore: true, loggedAt: true },
      }),
      this.prisma.focusSession.findMany({
        // kind: 'WORK' (Automatic Pomodoro work/break cycling increment) —
        // a break isn't a "finished-a-real-block-of-deep-work" signal, and
        // Pomodoro mode adds one BREAK row per WORK row, so leaving this
        // unfiltered would both dilute the daypart signal with rest time
        // and silently double this query's effective sample size for
        // anyone using Pomodoro mode.
        where: { userId, status: 'COMPLETED', kind: 'WORK' },
        orderBy: { startedAt: 'desc' },
        take: CHRONOTYPE_SAMPLE_SIZE,
        select: { startedAt: true },
      }),
    ]);

    if (
      energyEntries.length < MIN_ENERGY_SAMPLES_FOR_CHRONOTYPE ||
      completedFocusSessions.length < MIN_FOCUS_SESSIONS_FOR_CHRONOTYPE
    ) {
      return; // not enough empirical data on one or both signals yet
    }

    const energyByDaypart: Record<Daypart, number[]> = { MORNING: [], AFTERNOON: [], EVENING: [] };
    for (const e of energyEntries) {
      const daypart = daypartForHour(DateTime.fromJSDate(e.loggedAt, { zone: timezone }).hour);
      if (daypart) energyByDaypart[daypart].push(e.energyScore);
    }

    const focusCountByDaypart: Record<Daypart, number> = { MORNING: 0, AFTERNOON: 0, EVENING: 0 };
    for (const s of completedFocusSessions) {
      const daypart = daypartForHour(DateTime.fromJSDate(s.startedAt, { zone: timezone }).hour);
      if (daypart) focusCountByDaypart[daypart] += 1;
    }

    const avgEnergyByDaypart = Object.fromEntries(
      DAYPARTS.map((d) => [
        d,
        energyByDaypart[d].length
          ? energyByDaypart[d].reduce((sum, score) => sum + score, 0) / energyByDaypart[d].length
          : null,
      ]),
    ) as Record<Daypart, number | null>;

    const topEnergyDaypart = [...DAYPARTS]
      .filter((d) => avgEnergyByDaypart[d] !== null)
      .sort((a, b) => avgEnergyByDaypart[b]! - avgEnergyByDaypart[a]!)[0];
    const topFocusDaypart = [...DAYPARTS].sort((a, b) => focusCountByDaypart[b] - focusCountByDaypart[a])[0];

    if (!topEnergyDaypart || topEnergyDaypart !== topFocusDaypart) return; // the two signals disagree — nothing confident to say

    const daypart = topFocusDaypart;
    const daypartLabel =
      daypart === 'MORNING' ? 'a morning person' : daypart === 'AFTERNOON' ? 'sharpest in the afternoon' : 'an evening person';
    const content = `Empirically appears to be ${daypartLabel}: energy check-ins score highest in the ${daypart.toLowerCase()} (avg ${avgEnergyByDaypart[daypart]!.toFixed(1)}/5) and completed focus sessions also cluster there (${focusCountByDaypart[daypart]} of the last ${completedFocusSessions.length}) — this is behavioral, not just self-reported, so prefer scheduling demanding deep work during this window.`;

    await this.prisma.aiMemoryFact.upsert({
      where: { userId_factType_key: { userId, factType: 'chronotype', key: 'peak_daypart' } },
      create: {
        userId,
        factType: 'chronotype',
        key: 'peak_daypart',
        value: ({ text: content } satisfies StoredValue) as any,
        confidence: 1.0,
      },
      update: { value: ({ text: content } satisfies StoredValue) as any },
    });
  }

  // Journal sentiment analysis increment — closes the "journal sentiment
  // feeds mood inference" gap the README used to name under "not built
  // yet." JournalService.create writes a per-entry sentimentScore via
  // AnthropicClient.analyzeSentiment right when an entry is saved; this is
  // the second half of that pipeline, the same "recompute a small
  // aggregate fact best-effort right after fresh data comes in" shape as
  // refreshChronotypePattern/refreshTaskDurationAccuracyPattern above,
  // called from JournalService.create right after a successful sentiment
  // score. Only the most recent JOURNAL_SENTIMENT_SAMPLE_SIZE *scored*
  // entries are read (skipping any from before AI was configured, or from
  // a scoring call that failed) — an old, since-passed rough patch
  // shouldn't keep coloring the AI's read of how someone's doing today.
  async refreshJournalSentimentPattern(userId: string): Promise<void> {
    const recentEntries = await this.prisma.journalEntry.findMany({
      where: { userId, sentimentScore: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: JOURNAL_SENTIMENT_SAMPLE_SIZE,
      select: { sentimentScore: true },
    });

    if (recentEntries.length < MIN_JOURNAL_SENTIMENT_SAMPLES) return;

    const avgScore =
      recentEntries.reduce((sum, e) => sum + e.sentimentScore!, 0) / recentEntries.length;

    let content: string | null = null;
    if (avgScore <= -JOURNAL_SENTIMENT_TREND_THRESHOLD) {
      content = `Recent journal entries have trended emotionally negative (avg sentiment ${avgScore.toFixed(2)} on a -1 to 1 scale, over the last ${recentEntries.length} scored entries) — be extra gentle and avoid overly upbeat or dismissive tone in anything generated for this person right now.`;
    } else if (avgScore >= JOURNAL_SENTIMENT_TREND_THRESHOLD) {
      content = `Recent journal entries have trended emotionally positive (avg sentiment ${avgScore.toFixed(2)} on a -1 to 1 scale, over the last ${recentEntries.length} scored entries) — things seem to genuinely be going well lately.`;
    }

    if (!content) return; // close to neutral/mixed — nothing actionable to record

    await this.prisma.aiMemoryFact.upsert({
      where: { userId_factType_key: { userId, factType: 'journal_sentiment', key: 'sentiment_trend' } },
      create: {
        userId,
        factType: 'journal_sentiment',
        key: 'sentiment_trend',
        value: ({ text: content } satisfies StoredValue) as any,
        confidence: 1.0,
      },
      update: { value: ({ text: content } satisfies StoredValue) as any },
    });
  }
}
