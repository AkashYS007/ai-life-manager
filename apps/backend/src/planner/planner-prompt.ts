import { DateTime } from 'luxon';
import { PlanScope } from './models/ai-plan-run.model';
import { DEFAULT_TASK_DURATION_MINUTES } from './planner-helpers';

// planner.service.ts modularization increment (2026-08-26): the prompt-text
// construction pulled out on its own — it's pure string formatting with no
// DB/HTTP dependency of any kind, so it doesn't need to live inside the
// generation service itself and is easier to review/change in isolation
// from the policy logic that decides *what* to put in it.

// A fixed day count per scope, not a real calendar-week/calendar-month
// boundary (e.g. MONTH isn't "the rest of this calendar month," it's a
// rolling 30 days from today) — simplest correct approximation for a first
// pass, same "simple version first" spirit as every other increment's
// documented scope cut. Used by both plan-generation.service.ts
// (requestReplan) and plan-response.service.ts (computeImmovableIntervals),
// which is why this lives in the shared prompt file rather than either one.
export const SCOPE_WINDOW_DAYS: Record<PlanScope, number> = {
  [PlanScope.DAY]: 1,
  [PlanScope.WEEK]: 7,
  [PlanScope.MONTH]: 30,
};

export function buildPrompt(ctx: {
  now: Date;
  timezone: string;
  scope: PlanScope;
  windowEnd: Date;
  openTasks: Array<{ id: string; title: string; priority: number; estimatedDurationMinutes?: number; dueDate?: Date }>;
  eventsInWindow: Array<{ title: string; startTime: Date; endTime: Date; isImmovable: boolean }>;
  todayMood: { moodScore: number } | null;
  todayEnergy: { energyScore: number } | null;
  lastNightSleep: { durationMinutes?: number; qualityScore?: number } | null;
  memoryContext: string;
  protectedHabits: Array<{ title: string; start: Date; end: Date }>;
  flexibleHabits: string[];
  workdayStartHour: number;
  workdayEndHour: number;
}): string {
  const nowLocal = DateTime.fromJSDate(ctx.now, { zone: ctx.timezone });
  const isMultiDay = ctx.scope !== PlanScope.DAY;

  // DAY scope's intro/window line is byte-for-byte the same text this
  // function already produced before this increment — no behavior change
  // for the feature that was already shipped. WEEK/MONTH get their own
  // framing: a real date range instead of "today," and an explicit
  // instruction about the per-day working-hours window the policy layer
  // above now actually enforces for these two scopes (see
  // plan-generation.service.ts's withinWorkHours check).
  let introLine: string;
  let tasksIntro: string;
  let eventsIntro: string;
  if (!isMultiDay) {
    const dayWindowEnd = DateTime.min(
      DateTime.fromJSDate(ctx.windowEnd, { zone: ctx.timezone }),
      nowLocal.set({ hour: ctx.workdayEndHour, minute: 0, second: 0 }),
    );
    // Bug fix: this used to only ever state the current time-of-day
    // (HH:mm), never the actual calendar date — unlike the WEEK/MONTH
    // branch below, which always has. Since proposedStart now requires a
    // full date+time (see the tool schema's own bug-fix comment in
    // anthropic-client.ts), a model given only "11:15" and no date at all
    // has to guess what today's real date is — observed, live, guessing
    // wrong by over a year (a proposal dated May 2025 for an actual
    // request made in August 2026), which then got correctly rejected by
    // the policy layer for being "before now," making a perfectly healthy
    // model response look like a validation failure. Stating the date
    // explicitly, and repeating it right where proposedStart's exact
    // expected format is spelled out, removes the guess entirely.
    const todayDateLabel = nowLocal.toFormat('yyyy-MM-dd');
    introLine = `You are an AI Chief of Staff scheduling someone's remaining day. Today's date is ${todayDateLabel} (${nowLocal.toFormat('cccc')}), and the current time is ${nowLocal.toFormat('HH:mm')} (${ctx.timezone}). Only schedule between now and ${dayWindowEnd.toFormat('HH:mm')} today — do not propose anything after that or before now. Every proposedStart you return must use today's actual date, ${todayDateLabel} — do not guess or assume a different date.`;
    tasksIntro =
      'Open tasks (schedule zero or more of these — favor higher priority and due-soon tasks, and don\'t try to force in every task if the remaining time is too short):';
    eventsIntro = "Today's calendar (do not schedule over anything marked FIXED):";
  } else {
    const label = ctx.scope === PlanScope.WEEK ? 'week' : 'month';
    const windowEndLocal = DateTime.fromJSDate(ctx.windowEnd, { zone: ctx.timezone });
    introLine = `You are an AI Chief of Staff planning someone's ${label} ahead. Current time: ${nowLocal.toFormat('yyyy-MM-dd HH:mm')} (${ctx.timezone}). Propose specific dates and times for tasks any time between now and ${windowEndLocal.toFormat('yyyy-MM-dd')} — every proposedStart must be a full ISO datetime with both a date and a time, and the time must fall between ${ctx.workdayStartHour}:00 and ${ctx.workdayEndHour}:00 local time on whichever day you choose, never overnight.`;
    tasksIntro = `Open tasks (spread these sensibly across the ${label} ahead — favor higher priority and due-soon tasks, don't pile everything onto day one):`;
    eventsIntro = `This ${label}'s calendar (do not schedule over anything marked FIXED):`;
  }

  const tasksList = ctx.openTasks
    .map((t) => {
      const due = t.dueDate ? `, due ${DateTime.fromJSDate(t.dueDate, { zone: ctx.timezone }).toISODate()}` : '';
      return `- id=${t.id} | "${t.title}" | priority=${t.priority} (1=urgent, 4=someday) | estimated ${t.estimatedDurationMinutes ?? DEFAULT_TASK_DURATION_MINUTES} min${due}`;
    })
    .join('\n');

  const eventsList = ctx.eventsInWindow.length
    ? ctx.eventsInWindow
        .map((e) => {
          const startFormat = isMultiDay ? 'yyyy-MM-dd HH:mm' : 'HH:mm';
          const s = DateTime.fromJSDate(e.startTime, { zone: ctx.timezone }).toFormat(startFormat);
          const en = DateTime.fromJSDate(e.endTime, { zone: ctx.timezone }).toFormat('HH:mm');
          return `- ${s}-${en} "${e.title}"${e.isImmovable ? ' (FIXED — do not schedule anything over this)' : ''}`;
        })
        .join('\n')
    : '(none)';

  // Weekly/monthly plans protecting habits across the window increment: a
  // multi-day window includes a real date on each line now (same
  // `isMultiDay` pattern eventsList already used above it), since two
  // different days' 7am habit blocks would otherwise both print as the
  // same bare "07:00-07:15" with nothing telling them apart.
  const protectedHabitsList = ctx.protectedHabits.length
    ? ctx.protectedHabits
        .map((h) => {
          const startFormat = isMultiDay ? 'yyyy-MM-dd HH:mm' : 'HH:mm';
          const s = DateTime.fromJSDate(h.start, { zone: ctx.timezone }).toFormat(startFormat);
          const en = DateTime.fromJSDate(h.end, { zone: ctx.timezone }).toFormat('HH:mm');
          return `- ${s}-${en} "${h.title}" (FIXED — protected habit time, do not schedule anything over this)`;
        })
        .join('\n')
    : '(none)';

  const flexibleHabitsLine = ctx.flexibleHabits.length
    ? `Also needs to happen ${isMultiDay ? 'at some point each day it recurs' : 'today'}, no fixed time — try to leave room for these too: ${ctx.flexibleHabits
        .map((t) => `"${t}"`)
        .join(', ')}`
    : '';

  const stateLines = [
    ctx.todayMood ? `Mood check-in today: ${ctx.todayMood.moodScore}/5` : 'Mood: not checked in today',
    ctx.todayEnergy ? `Energy check-in today: ${ctx.todayEnergy.energyScore}/5` : 'Energy: not checked in today',
    ctx.lastNightSleep?.durationMinutes
      ? `Last night's sleep: ${Math.round((ctx.lastNightSleep.durationMinutes / 60) * 10) / 10}h${
          ctx.lastNightSleep.qualityScore ? `, quality ${ctx.lastNightSleep.qualityScore}/5` : ''
        }`
      : "Last night's sleep: not logged",
  ].join('\n');

  const memorySection = ctx.memoryContext
    ? `\nThings this person has told the AI to remember — treat these as hard preferences, not suggestions:\n${ctx.memoryContext}\n`
    : '';

  // Weekly/monthly plans protecting habits across the window increment:
  // every due day's habit time is real protected time now, not just
  // today's — the intro line below reflects that directly instead of the
  // disclaimer that used to sit here explaining why it wasn't true yet.
  const habitsIntro = isMultiDay
    ? `This ${ctx.scope === PlanScope.WEEK ? 'week' : 'month'}'s protected habit time (do not schedule over anything marked FIXED):`
    : "Today's protected habit time (do not schedule over anything marked FIXED):";

  return `${introLine}

${tasksIntro}
${tasksList}

${eventsIntro}
${eventsList}

${habitsIntro}
${protectedHabitsList}
${flexibleHabitsLine ? `\n${flexibleHabitsLine}\n` : ''}
How the person is doing right now:
${stateLines}
If energy or mood is low (2 or below), prefer shorter or lower-priority tasks and leave more open gaps rather than packing the day tightly. If sleep was short (under 6h) or low quality, be more conservative about scheduling demanding tasks back-to-back.
${memorySection}
Call propose_schedule with your proposed times. Only use task ids from the list above.`;
}
