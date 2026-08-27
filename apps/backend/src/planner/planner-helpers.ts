import { DateTime } from 'luxon';

// planner.service.ts modularization increment (2026-08-26): every small,
// stateless piece of logic the original monolithic PlannerService shared
// across its generation path, its response/edit path, and — for the two
// exports below — ChatService's tool-calling handlers, pulled out to one
// file with no NestJS DI of its own (pure functions/constants only) so any
// of those consumers can import directly without a module cycle.

// Exported for the Tool-calling actions in Chat increment — ChatService's
// reschedule_task tool handler needs the exact same "no real estimate yet,
// assume this long" fallback the planner already uses, rather than picking
// its own separate default number. Re-exported from planner.service.ts
// (unchanged import path) so chat.service.ts's existing
// `import { DEFAULT_TASK_DURATION_MINUTES } from '../planner/planner.service'`
// keeps working without any edit there.
export const DEFAULT_TASK_DURATION_MINUTES = 30;

// Fallbacks used until a person sets real work hours (Diagnostic onboarding
// increment's workHoursStart/End on User, see schema.prisma) — only
// enforced by the policy layer for WEEK/MONTH scope, see
// plan-generation.service.ts's requestReplan.
// Every account created before that increment, or that skipped the
// onboarding quiz step, simply keeps using these exact defaults, so nothing
// about DAY scope's behavior (which never applied this bound anyway) or an
// existing WEEK/MONTH user's plans changes just from this field existing.
export const DEFAULT_WORKDAY_START_HOUR = 7; // 7am local
export const DEFAULT_WORKDAY_END_HOUR = 21; // 9pm local

// Only the hour matters here — WORKDAY_START_HOUR/END_HOUR were always
// whole-hour constants, and the policy-layer/prompt-text check below is
// hour-granular too, so a person who sets e.g. "7:30" is simply floored to
// 7 rather than adding partial-hour handling nothing else in this file has.
export function workdayHourFromHHmm(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const hour = parseInt(value.split(':')[0], 10);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : fallback;
}

// Bug fix: parses a raw `proposedStart` string straight from Anthropic's
// tool-use response — untrusted input, same as everything else about
// `proposal.changes` the generation service already re-validates. The
// prompt tells the model the current time in the user's *local* timezone
// and asks for a datetime "later today," but the tool schema only asks for
// "ISO 8601" — it never actually requires the model to include a UTC
// offset. When the model's response omits one (a real, observed case, not
// hypothetical — this is exactly what was silently dropping every proposal
// on a completely empty account, nothing left to conflict with), `new
// Date(raw)` parses it as local time *to wherever the Node process happens
// to be running* — which, on a server not itself set to the user's
// timezone (the common case), silently shifts the intended instant by
// however many hours separate the two, often enough to push a "this
// afternoon" proposal outside the [now, windowEnd) window entirely and make
// it look invalid. Fixed the same way this file already interprets a bare
// wall-clock time elsewhere (see habitProtectedInterval, which does the
// identical thing for a habit's `preferredTime`): if the string already
// carries explicit UTC/offset info, trust it as an absolute instant;
// otherwise, interpret it as local wall-clock time in the user's *real*
// stored timezone, not the server's.
const HAS_EXPLICIT_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;

// Exported (not just module-private) for the Tool-calling actions in Chat
// increment — ChatService's reschedule_task tool handler needs the exact
// same "an offset-less AI-supplied datetime string means local wall-clock
// time in the person's real timezone, not the server's" parsing already
// established for AI-proposed schedule changes, reused rather than
// re-implemented a second time. Same re-export-from-planner.service.ts
// note as DEFAULT_TASK_DURATION_MINUTES above.
export function parseAiDateTime(raw: string, timezone: string): Date {
  if (typeof raw !== 'string' || !raw) return new Date(NaN);
  if (HAS_EXPLICIT_OFFSET.test(raw.trim())) {
    return new Date(raw);
  }
  const parsed = DateTime.fromISO(raw, { zone: timezone });
  return parsed.isValid ? parsed.toJSDate() : new Date(raw);
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

// Converts a habit's "HH:mm" preferredTime (a plain wall-clock string, no
// date attached — see HabitsService's Habit.preferredTime docs) into a real
// today-dated interval in the user's timezone, the same shape the policy
// layer already uses for calendar-event intervals.
export function habitProtectedInterval(
  preferredTime: string,
  protectedDurationMinutes: number,
  now: Date,
  timezone: string,
): { start: Date; end: Date } {
  const [hour, minute] = preferredTime.split(':').map(Number);
  const start = DateTime.fromJSDate(now, { zone: timezone }).set({ hour, minute, second: 0, millisecond: 0 });
  const end = start.plus({ minutes: protectedDurationMinutes });
  return { start: start.toJSDate(), end: end.toJSDate() };
}
