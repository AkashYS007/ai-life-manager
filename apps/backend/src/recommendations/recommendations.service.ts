import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { zonedDayBounds } from '../common/date/zoned-day';
import { TasksService } from '../tasks/tasks.service';
import { CalendarService } from '../calendar/calendar.service';
import { SignalsService } from '../signals/signals.service';
import { HabitsService } from '../habits/habits.service';
import { MemoryService } from '../memory/memory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AnthropicClient } from '../planner/anthropic-client';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { FocusService } from '../focus/focus.service';
import { FocusSessionKind } from '../focus/models/focus-session.model';
import { AiRecommendationRun, RecommendationCategory } from './models/recommendation.model';
import { ActOnRecommendationInput } from './dto/act-on-recommendation.input';

// AI recommendations acting on your behalf increment: a genuine recovery
// break someone actually tapped "Take this break" for, not a link in a
// Pomodoro chain — deliberately longer than Pomodoro mode's own 5-minute
// short break (see focus/page.tsx's SHORT_BREAK_MINUTES) since there's no
// surrounding work-block cadence here to keep short for.
const ACTED_ON_BREAK_MINUTES = 15;

// Booking a workout as a real calendar block increment: a plain, sane
// default length for a suggestion with no duration of its own ("Take a walk"
// carries no inherent minute count) — half an hour is enough for a real
// short workout without needing to ask a follow-up question first, matching
// this feature's existing "one tap, no second form" spirit. Booked starting
// right now, the same "act immediately, don't ask what time" choice
// ACTED_ON_BREAK_MINUTES's BREAK path already makes.
const ACTED_ON_WORKOUT_MINUTES = 30;

interface StoredRecommendation {
  id: string;
  category: RecommendationCategory;
  message: string;
  dismissed: boolean;
}

const VALID_CATEGORIES = new Set(Object.values(RecommendationCategory));

// Distinct error types (not just a generic Error) for actOn's two
// predictable, non-exceptional states — same reasoning
// FocusSessionAlreadyActiveError/FocusSessionNotActiveError already
// document: these are expected code paths a real user will hit in normal
// use (clicking an already-acted-on suggestion, or already having a focus
// session running), not bugs, so the resolver maps them to specific error
// codes with a fixed, friendly message.
export class RecommendationNotFoundError extends Error {
  constructor() {
    super("That recommendation isn't there anymore.");
    this.name = 'RecommendationNotFoundError';
  }
}

export class RecommendationAlreadyHandledError extends Error {
  constructor() {
    super("You've already acted on or dismissed this recommendation.");
    this.name = 'RecommendationAlreadyHandledError';
  }
}

// Locally-duplicated day-boundary helper — same "not shared/exported"
// precedent as signals.service.ts/reflection.service.ts/routines.service.ts
// each keeping their own copy rather than a shared util.
function toDateOnly(instant: Date, timezone: string): Date {
  const isoDate = DateTime.fromJSDate(instant, { zone: timezone }).toISODate();
  return new Date(isoDate!);
}

function hydrate(record: any): AiRecommendationRun {
  return {
    id: record.id,
    date: record.date,
    recommendations: record.recommendations as StoredRecommendation[],
    modelUsed: record.modelUsed ?? undefined,
    generatedAt: record.generatedAt,
  };
}

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly calendarService: CalendarService,
    private readonly signalsService: SignalsService,
    private readonly habitsService: HabitsService,
    private readonly memoryService: MemoryService,
    private readonly notificationsService: NotificationsService,
    private readonly anthropic: AnthropicClient,
    private readonly focusService: FocusService,
    // AI cost telemetry increment.
    private readonly aiUsage: AiUsageService,
  ) {}

  async getToday(userId: string, timezone: string): Promise<AiRecommendationRun | null> {
    const date = toDateOnly(new Date(), timezone);
    const record = await this.prisma.aiRecommendationRun.findUnique({
      where: { userId_date: { userId, date } },
    });
    return record ? hydrate(record) : null;
  }

  // Reuses sendMessage's plain-text path (not a new forced-tool schema on
  // AnthropicClient — same "avoid scope creep on a shared interface every
  // other AI feature's e2e fake also has to implement" reasoning
  // RoutinesService.aiSequence already documents) with a strict, easy-to-
  // parse line format instead of JSON, then validates every line before
  // trusting it — same "validate before trusting" spirit as
  // RoutinesService's permutation check and PlannerService's deterministic
  // policy layer, just shaped for this feature: drop any line that isn't
  // exactly `CATEGORY|message` with a real category, rather than trusting
  // the model's formatting held.
  async generate(userId: string, timezone: string): Promise<AiRecommendationRun> {
    if (!this.anthropic.isConfigured()) {
      throw new Error('AI_NOT_CONFIGURED');
    }

    const { start: dayStart, end: dayEnd } = zonedDayBounds(new Date(), timezone);
    const [openTasks, todaysEvents, todayMood, todayEnergy, lastNightSleep, memoryContext, dueHabits] =
      await Promise.all([
        this.tasksService.listOpenForUser(userId),
        this.calendarService.listInRange(userId, dayStart, dayEnd),
        this.signalsService.getTodayMood(userId, timezone),
        this.signalsService.getTodayEnergy(userId, timezone),
        this.signalsService.getLastNightSleep(userId, timezone),
        this.memoryService.buildContextBlock(userId),
        this.habitsService.listDueToday(userId, timezone),
      ]);

    const nowLocal = DateTime.fromJSDate(new Date(), { zone: timezone });
    const tasksList = openTasks.length
      ? openTasks.map((t) => `- "${t.title}" (priority ${t.priority})`).join('\n')
      : '(no open tasks)';
    const eventsList = todaysEvents.length
      ? todaysEvents
          .map((e) => {
            const s = DateTime.fromJSDate(e.startTime, { zone: timezone }).toFormat('HH:mm');
            const en = DateTime.fromJSDate(e.endTime, { zone: timezone }).toFormat('HH:mm');
            return `- ${s}-${en} "${e.title}"`;
          })
          .join('\n')
      : '(nothing on the calendar today)';
    const habitsList = dueHabits.length ? dueHabits.map((h) => `- "${h.title}"`).join('\n') : '(none due today)';
    const stateLines = [
      todayMood ? `Mood check-in today: ${todayMood.moodScore}/5` : 'Mood: not checked in today',
      todayEnergy ? `Energy check-in today: ${todayEnergy.energyScore}/5` : 'Energy: not checked in today',
      lastNightSleep?.durationMinutes
        ? `Last night's sleep: ${Math.round((lastNightSleep.durationMinutes / 60) * 10) / 10}h`
        : "Last night's sleep: not logged",
    ].join('\n');
    const memorySection = memoryContext
      ? `\nThings this person has told the AI to remember — treat these as real context:\n${memoryContext}\n`
      : '';

    const system =
      'You are a supportive AI Chief of Staff for a personal life-planning app. Suggest 1 to 3 short, specific, actionable recommendations for right now, each falling into one of exactly three categories: BREAK (rest/recovery), WORKOUT (movement/exercise), MEAL (eating/hydration). Reply with ONLY one recommendation per line, in the exact format "CATEGORY|message" (message under 150 characters, one or two sentences, no markdown). No other text, no numbering, no blank lines. Only suggest a category if it actually fits the person\'s current day — do not force all three every time.';

    const prompt = `Current time: ${nowLocal.toFormat('HH:mm')} (${timezone})

Open tasks today:
${tasksList}

Calendar today:
${eventsList}

Habits still due today:
${habitsList}

${stateLines}
${memorySection}`;

    const { content, modelUsed, usage } = await this.anthropic.sendMessage([{ role: 'user', content: prompt }], system);
    void this.aiUsage.record({
      userId,
      feature: 'recommendations',
      model: modelUsed,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });

    const recommendations: StoredRecommendation[] = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf('|');
        if (separatorIndex === -1) return null;
        const category = line.slice(0, separatorIndex).trim().toUpperCase();
        const message = line.slice(separatorIndex + 1).trim().slice(0, 200);
        if (!VALID_CATEGORIES.has(category as RecommendationCategory) || !message) return null;
        // randomUUID() is typed as a branded template-literal string in
        // newer @types/node (`${string}-${string}-${string}-${string}-${string}`),
        // not plain `string` — widening it explicitly here keeps this
        // object literal's inferred type matching StoredRecommendation.id's
        // plain `string`, which the type predicate below requires.
        return { id: randomUUID() as string, category: category as RecommendationCategory, message, dismissed: false };
      })
      .filter((r): r is StoredRecommendation => r !== null)
      .slice(0, 3);

    if (recommendations.length === 0) {
      throw new Error('No valid recommendations in the AI response');
    }

    const date = toDateOnly(new Date(), timezone);
    const record = await this.prisma.aiRecommendationRun.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, recommendations: recommendations as any, modelUsed },
      update: { recommendations: recommendations as any, modelUsed, generatedAt: new Date() },
    });

    // Smart notifications increment: best-effort, same principle as
    // PlannerService's plan_ready trigger — never break the actual
    // generation the user is waiting on. Batched by NotificationsService
    // itself, so tapping Refresh a few times in a row updates one
    // notification rather than piling up several.
    try {
      await this.notificationsService.create(userId, timezone, 'recommendations_ready', {
        title: 'New recommendations ready',
        body: `${recommendations.length} new suggestion${recommendations.length === 1 ? '' : 's'} for today.`,
        deeplink: '/today',
      });
    } catch (error) {
      this.logger.warn(`recommendations_ready notification failed: ${(error as Error).message}`);
    }

    return hydrate(record);
  }

  // Dismissing only ever targets today's run — there's no route to an old
  // day's recommendations in this UI, so "today" is looked up the same way
  // getToday does rather than taking a date from the caller.
  async dismiss(userId: string, timezone: string, id: string): Promise<AiRecommendationRun> {
    const date = toDateOnly(new Date(), timezone);
    const record = await this.prisma.aiRecommendationRun.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!record) {
      throw new Error('Recommendation not found');
    }

    // record.recommendations is Prisma's generated JsonValue here (this
    // findUnique result isn't typed `any` the way hydrate()'s param is), so
    // this needs the same `as unknown as` intermediate cast as
    // memory.service.ts's buildContextBlock — a direct cast fails to
    // compile since JsonValue and StoredRecommendation[] don't sufficiently
    // structurally overlap.
    const recommendations = (record.recommendations as unknown as StoredRecommendation[]).map((r) =>
      r.id === id ? { ...r, dismissed: true } : r,
    );
    if (!recommendations.some((r) => r.id === id)) {
      throw new Error('Recommendation not found');
    }

    const updated = await this.prisma.aiRecommendationRun.update({
      where: { id: record.id },
      data: { recommendations: recommendations as any },
    });

    return hydrate(updated);
  }

  // AI recommendations acting on your behalf increment: reverses this
  // feature's own long-standing "propose-only, never-auto-committed" spirit
  // (see AiRecommendationsCard.tsx's own comment) specifically for these
  // three categories, on purpose — a BREAK recommendation really does start
  // a real focus session the moment you tap it, a WORKOUT recommendation
  // really does place a real calendar block, and a MEAL recommendation
  // really does create a real open task, all with the one tap, not a
  // "navigate to a pre-filled form and confirm again" second step. Dismiss
  // (unchanged, above) is still there for "no thanks."
  //
  // MEAL is the one category with no real domain of its own anywhere in
  // this app (no meal log), so "acting on" it means the same real thing a
  // person would otherwise type by hand: a plain open task titled with the
  // recommendation's own message, picked up by the AI planner and shown on
  // Today exactly like any other task from here on. BREAK and WORKOUT each
  // get a genuinely different action because this app already has a real
  // domain for both: FocusSession's `kind: BREAK` (see the Automatic
  // Pomodoro work/break cycling increment) for BREAK, reusing
  // FocusService.start rather than reimplementing its one-active-session-
  // at-a-time guard; and a real `CalendarEvent` — booked for
  // ACTED_ON_WORKOUT_MINUTES, starting at the first real open slot at or
  // after "now" (see the Workout-booking conflict avoidance increment and
  // CalendarService.findNextOpenSlot's own comment) — for WORKOUT (see the
  // Booking a workout as a real calendar block increment).
  //
  // Customize act-on defaults at the point of acting increment: `input` is
  // optional and every field on it is optional too — a plain `actOn(userId,
  // timezone, id)` call (or one with `input` explicitly omitted/undefined)
  // reproduces the exact fixed-default behavior this method always had.
  // Each branch below only ever reads the one or two fields that actually
  // apply to its own category; a field that doesn't apply (e.g. `priority`
  // sent alongside a BREAK recommendation) is silently ignored rather than
  // rejected — the caller (AiRecommendationsCard) already knows which
  // category it's showing a customize panel for, so this isn't a real gap,
  // just a deliberately permissive input shape shared across all three
  // categories instead of three near-identical ones.
  async actOn(
    userId: string,
    timezone: string,
    id: string,
    input?: ActOnRecommendationInput,
  ): Promise<{
    recommendationRun: AiRecommendationRun;
    startedFocusSessionId?: string;
    bookedCalendarEventId?: string;
    createdTaskId?: string;
  }> {
    const date = toDateOnly(new Date(), timezone);
    const record = await this.prisma.aiRecommendationRun.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!record) {
      throw new RecommendationNotFoundError();
    }

    const recommendations = record.recommendations as unknown as StoredRecommendation[];
    const target = recommendations.find((r) => r.id === id);
    if (!target) {
      throw new RecommendationNotFoundError();
    }
    if (target.dismissed) {
      throw new RecommendationAlreadyHandledError();
    }

    let startedFocusSessionId: string | undefined;
    let bookedCalendarEventId: string | undefined;
    let createdTaskId: string | undefined;

    if (target.category === RecommendationCategory.BREAK) {
      // Propagates FocusSessionAlreadyActiveError as-is if one's already
      // running — the resolver below maps it to the same ALREADY_ACTIVE
      // code the focus resolver's own startFocusSession mutation uses,
      // rather than this method swallowing or re-wrapping it.
      const session = await this.focusService.start(userId, {
        plannedDurationMinutes: input?.durationMinutes ?? ACTED_ON_BREAK_MINUTES,
        kind: FocusSessionKind.BREAK,
      });
      startedFocusSessionId = session.id;
    } else if (target.category === RecommendationCategory.WORKOUT) {
      const desiredStart = input?.startTime ?? new Date();
      const durationMinutes = input?.durationMinutes ?? ACTED_ON_WORKOUT_MINUTES;
      // Workout-booking conflict avoidance increment: the real booked time
      // may land later than `desiredStart` if something's already there —
      // see CalendarService.findNextOpenSlot's own comment for the search
      // behavior and the deliberate "quiet, best-effort, same treatment for
      // a default or custom time" reasoning. Applied uniformly whether
      // `desiredStart` came from the fixed "right now" default or a
      // person's own explicit Customize choice.
      const startTime = await this.calendarService.findNextOpenSlot(userId, desiredStart, durationMinutes);
      const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
      const event = await this.calendarService.create(
        userId,
        { title: target.message, startTime, endTime },
        { isAiFocusBlock: true },
      );
      bookedCalendarEventId = event.id;
    } else {
      const task = await this.tasksService.create(userId, {
        title: target.message,
        priority: input?.priority,
        dueDate: input?.dueDate,
      });
      createdTaskId = task.id;
    }

    const updatedRecommendations = recommendations.map((r) => (r.id === id ? { ...r, dismissed: true } : r));
    const updated = await this.prisma.aiRecommendationRun.update({
      where: { id: record.id },
      data: { recommendations: updatedRecommendations as any },
    });

    return { recommendationRun: hydrate(updated), startedFocusSessionId, bookedCalendarEventId, createdTaskId };
  }
}
