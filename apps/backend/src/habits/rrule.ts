import { DateTime } from 'luxon';

// Habits domain (Database Design Document §4.4). `habits.rrule` is a real
// iCalendar RRULE string. This started as "Simple patterns first" (every
// day, or specific days of the week) — the Full custom habit recurrence
// increment extended it to four more real iCalendar shapes: every N days,
// every N weeks on specific days, monthly on a specific day-of-month (or
// the last day), and monthly on the Nth (or last) weekday. The Fuller habit
// recurrence increment extended it twice more: every MONTHLY shape gained
// its own `INTERVAL` (every N months, not just every month), and every
// shape gained an optional `COUNT` (recur exactly N times, then stop for
// good) or `UNTIL` (never recur past a given date) — the two are mutually
// exclusive, matching real RRULE semantics. The BYSETPOS / multiple
// weekdays per month increment adds two more real MONTHLY shapes on top of
// those: several specific days of the month in one rule (real, multi-value
// `BYMONTHDAY`), and "the Nth (or last) day among a set of weekdays" (real
// `BYSETPOS`, combined with a plain multi-value `BYDAY` — the classic "last
// weekday of the month" pattern). Still deliberately not a general RRULE
// parser — these are eight named shapes (now ten, counting the two new
// MONTHLY ones) × an optional COUNT/UNTIL end condition, what the API
// exposes, not "anything RRULE can express" (no WKST override, no BYSETPOS
// combined with anything other than a plain BYDAY set, no BYMONTHDAY mixed
// with BYDAY in the same rule, etc.). The column itself can hold any valid
// RRULE, so richer patterns later are still just an API change, not a
// schema migration.
export type HabitRecurrence = (
  | { frequency: 'DAILY'; intervalDays: number }
  | { frequency: 'WEEKLY'; daysOfWeek: number[]; intervalWeeks: number }
  | { frequency: 'MONTHLY'; mode: 'DAY_OF_MONTH'; dayOfMonth: number; intervalMonths: number }
  | { frequency: 'MONTHLY'; mode: 'NTH_WEEKDAY'; weekday: number; ordinal: number; intervalMonths: number }
  // BYSETPOS / multiple weekdays per month increment. Several specific
  // days of the month in one rule ("the 1st and 15th") — a real,
  // multi-value BYMONTHDAY, not two separate habits. Requires at least 2
  // distinct days: a single day belongs to DAY_OF_MONTH above (which also
  // supports -1 for "the last day," deliberately not duplicated here — see
  // this mode's own comment on buildRrule for why "-1" isn't accepted
  // alongside other specific days in this mode).
  | { frequency: 'MONTHLY'; mode: 'DAYS_OF_MONTH'; daysOfMonth: number[]; intervalMonths: number }
  // "The Nth (or last) day of the month whose weekday is in this set" — a
  // real BYSETPOS applied to a plain (non-ordinal-prefixed) multi-value
  // BYDAY, e.g. weekdaySet=[1,2,3,4,5] (Mon-Fri) + ordinal=-1 is the classic
  // "last weekday of the month." Genuinely different from NTH_WEEKDAY above,
  // which picks one specific weekday's Nth occurrence (e.g. "the 3rd
  // Tuesday") — this picks the Nth day *of any weekday in the set*,
  // counting across all of them together in date order.
  | { frequency: 'MONTHLY'; mode: 'NTH_WEEKDAY_SET'; weekdaySet: number[]; ordinal: number; intervalMonths: number }
) & {
  // At most one of these is ever set — buildRrule throws if both are
  // present, the same fail-loud-at-the-write-boundary instinct every other
  // impossible-combination check in this file already uses. `until` is a
  // plain calendar date (`YYYY-MM-DD`), inclusive — the last day an
  // occurrence can still land on, not the first day it can't.
  count?: number;
  until?: string;
};

// iCalendar BYDAY codes, indexed by ISO weekday (Luxon's `.weekday`: 1=Monday..7=Sunday).
const BYDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function assertWeekday(d: number) {
  if (!Number.isInteger(d) || d < 1 || d > 7) {
    throw new Error('daysOfWeek must use ISO weekday numbers: 1 (Monday) through 7 (Sunday).');
  }
}

// Shared by NTH_WEEKDAY_SET and (for the ordinal half) NTH_WEEKDAY above —
// 1-4 (first through fourth), or -1 for "the last." A weekday *set* with
// several days in it (say, all five weekdays) will always have well more
// than 4 matches in a real month, but the realistic use cases for this
// shape ("the 1st business day," "the last weekday") all fall within this
// same small range NTH_WEEKDAY already established, so it's reused as-is
// rather than opened up to an arbitrary ordinal.
function assertOrdinal(ordinal: number) {
  if (!Number.isInteger(ordinal) || ordinal === 0 || ordinal < -1 || ordinal > 4) {
    throw new Error('ordinal must be 1-4 (first through fourth), or -1 for the last.');
  }
}

const UNTIL_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// Appended to any of the base shapes below — shared by all of them rather
// than duplicated per-branch, since "how a recurrence ends" is orthogonal
// to "which days it lands on."
function buildEndCondition(recurrence: HabitRecurrence): string {
  if (recurrence.count != null && recurrence.until != null) {
    throw new Error('A habit can have a COUNT or an UNTIL date, not both.');
  }
  if (recurrence.count != null) {
    if (!Number.isInteger(recurrence.count) || recurrence.count < 1) {
      throw new Error('count must be a positive integer.');
    }
    return `;COUNT=${recurrence.count}`;
  }
  if (recurrence.until != null) {
    if (!UNTIL_FORMAT.test(recurrence.until) || !DateTime.fromISO(recurrence.until).isValid) {
      throw new Error('until must be a real calendar date in YYYY-MM-DD format.');
    }
    return `;UNTIL=${recurrence.until.replace(/-/g, '')}`;
  }
  return '';
}

export function buildRrule(recurrence: HabitRecurrence): string {
  const end = buildEndCondition(recurrence);

  if (recurrence.frequency === 'DAILY') {
    const n = recurrence.intervalDays;
    if (!Number.isInteger(n) || n < 1) {
      throw new Error('intervalDays must be a positive integer.');
    }
    return (n === 1 ? 'FREQ=DAILY' : `FREQ=DAILY;INTERVAL=${n}`) + end;
  }

  if (recurrence.frequency === 'WEEKLY') {
    const days = Array.from(new Set(recurrence.daysOfWeek)).sort((a, b) => a - b);
    if (days.length === 0) {
      throw new Error('A weekly habit needs at least one day of the week.');
    }
    days.forEach(assertWeekday);
    const n = recurrence.intervalWeeks;
    if (!Number.isInteger(n) || n < 1) {
      throw new Error('intervalWeeks must be a positive integer.');
    }
    const byday = days.map((d) => BYDAY_CODES[d - 1]).join(',');
    return (n === 1 ? `FREQ=WEEKLY;BYDAY=${byday}` : `FREQ=WEEKLY;INTERVAL=${n};BYDAY=${byday}`) + end;
  }

  // MONTHLY
  const monthsN = recurrence.intervalMonths;
  if (!Number.isInteger(monthsN) || monthsN < 1) {
    throw new Error('intervalMonths must be a positive integer.');
  }
  const monthsPrefix = monthsN === 1 ? 'FREQ=MONTHLY' : `FREQ=MONTHLY;INTERVAL=${monthsN}`;

  if (recurrence.mode === 'DAY_OF_MONTH') {
    const d = recurrence.dayOfMonth;
    // -1 is the iCalendar convention for "last day of the month" — counting
    // from the end, same as BYMONTHDAY's own negative-value meaning.
    if (!Number.isInteger(d) || d === 0 || d < -1 || d > 31) {
      throw new Error('dayOfMonth must be 1-31, or -1 for the last day of the month.');
    }
    return `${monthsPrefix};BYMONTHDAY=${d}` + end;
  }

  if (recurrence.mode === 'DAYS_OF_MONTH') {
    const days = Array.from(new Set(recurrence.daysOfMonth)).sort((a, b) => a - b);
    // Deliberately no -1 ("last day") support in this mode, unlike
    // DAY_OF_MONTH above — mixing "the last day" with specific numbered
    // days in one BYMONTHDAY list is real, valid RRULE, but it's an edge
    // case with no clear UI for picking it that felt worth building; a
    // single "last day" habit already has its own path through
    // DAY_OF_MONTH. A lone day here would also be indistinguishable, once
    // parsed back, from an ordinary DAY_OF_MONTH habit (same RRULE string
    // either way) — requiring at least 2 keeps this mode's own round-trip
    // unambiguous rather than silently normalizing to the other mode.
    if (days.length < 2) {
      throw new Error('DAYS_OF_MONTH needs at least 2 different days of the month — a single day belongs to DAY_OF_MONTH instead.');
    }
    for (const d of days) {
      if (!Number.isInteger(d) || d < 1 || d > 31) {
        throw new Error('Each day of the month must be 1-31.');
      }
    }
    return `${monthsPrefix};BYMONTHDAY=${days.join(',')}` + end;
  }

  if (recurrence.mode === 'NTH_WEEKDAY_SET') {
    const weekdays = Array.from(new Set(recurrence.weekdaySet)).sort((a, b) => a - b);
    if (weekdays.length === 0) {
      throw new Error('NTH_WEEKDAY_SET needs at least one weekday in its set.');
    }
    weekdays.forEach(assertWeekday);
    assertOrdinal(recurrence.ordinal);
    const byday = weekdays.map((d) => BYDAY_CODES[d - 1]).join(',');
    return `${monthsPrefix};BYDAY=${byday};BYSETPOS=${recurrence.ordinal}` + end;
  }

  // NTH_WEEKDAY
  assertWeekday(recurrence.weekday);
  assertOrdinal(recurrence.ordinal);
  return `${monthsPrefix};BYDAY=${recurrence.ordinal}${BYDAY_CODES[recurrence.weekday - 1]}` + end;
}

// Parses back into the structured shape the API/UI actually work with — the
// inverse of buildRrule. Returns null for any RRULE this API didn't itself
// produce (e.g. if the column is ever hand-edited to a richer pattern)
// rather than guessing at an interpretation.
export function parseRrule(rrule: string): HabitRecurrence | null {
  // The optional shared suffix every base shape can carry — matched once,
  // stripped off, and the remaining prefix is what each shape's own regex
  // below actually recognizes. Keeps the shape-regexes themselves exactly
  // as narrow as they'd be without this suffix.
  const endMatch = /;(?:COUNT=(\d+)|UNTIL=(\d{8}))$/.exec(rrule);
  let end: { count?: number; until?: string } = {};
  let base = rrule;
  if (endMatch) {
    base = rrule.slice(0, endMatch.index);
    if (endMatch[1]) {
      const count = Number(endMatch[1]);
      if (count < 1) return null;
      end = { count };
    } else {
      const raw = endMatch[2]; // YYYYMMDD
      const until = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      if (!DateTime.fromISO(until).isValid) return null;
      end = { until };
    }
  }

  if (base === 'FREQ=DAILY') {
    return { frequency: 'DAILY', intervalDays: 1, ...end };
  }
  const dailyInterval = /^FREQ=DAILY;INTERVAL=(\d+)$/.exec(base);
  if (dailyInterval) {
    const n = Number(dailyInterval[1]);
    if (n < 1) return null;
    return { frequency: 'DAILY', intervalDays: n, ...end };
  }

  const weekly = /^FREQ=WEEKLY;(?:INTERVAL=(\d+);)?BYDAY=([A-Z,]+)$/.exec(base);
  if (weekly) {
    const codes = weekly[2].split(',');
    const daysOfWeek: number[] = [];
    for (const code of codes) {
      const index = BYDAY_CODES.indexOf(code);
      if (index === -1) return null;
      daysOfWeek.push(index + 1);
    }
    const intervalWeeks = weekly[1] ? Number(weekly[1]) : 1;
    if (intervalWeeks < 1) return null;
    return { frequency: 'WEEKLY', daysOfWeek, intervalWeeks, ...end };
  }

  const monthlyByDate = /^FREQ=MONTHLY;(?:INTERVAL=(\d+);)?BYMONTHDAY=(-?\d+)$/.exec(base);
  if (monthlyByDate) {
    const d = Number(monthlyByDate[2]);
    if (d === 0 || d < -1 || d > 31) return null;
    const intervalMonths = monthlyByDate[1] ? Number(monthlyByDate[1]) : 1;
    if (intervalMonths < 1) return null;
    return { frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: d, intervalMonths, ...end };
  }

  // BYSETPOS / multiple weekdays per month increment. Tried after the
  // single-value BYMONTHDAY regex above (which anchors on no comma being
  // present, via `\d+$`), so a real single-day habit is always parsed as
  // DAY_OF_MONTH, never routed through here — matching buildRrule's own
  // "DAYS_OF_MONTH always emits 2+ comma-separated values" guarantee.
  const monthlyByDates = /^FREQ=MONTHLY;(?:INTERVAL=(\d+);)?BYMONTHDAY=(\d+(?:,\d+)+)$/.exec(base);
  if (monthlyByDates) {
    const daysOfMonth = monthlyByDates[2].split(',').map(Number);
    for (const d of daysOfMonth) {
      if (d < 1 || d > 31) return null;
    }
    const intervalMonths = monthlyByDates[1] ? Number(monthlyByDates[1]) : 1;
    if (intervalMonths < 1) return null;
    return { frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth, intervalMonths, ...end };
  }

  const monthlyByWeekday = /^FREQ=MONTHLY;(?:INTERVAL=(\d+);)?BYDAY=(-?\d)([A-Z]{2})$/.exec(base);
  if (monthlyByWeekday) {
    const ordinal = Number(monthlyByWeekday[2]);
    const index = BYDAY_CODES.indexOf(monthlyByWeekday[3]);
    if (index === -1 || ordinal === 0 || ordinal < -1 || ordinal > 4) return null;
    const intervalMonths = monthlyByWeekday[1] ? Number(monthlyByWeekday[1]) : 1;
    if (intervalMonths < 1) return null;
    return { frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: index + 1, ordinal, intervalMonths, ...end };
  }

  // BYSETPOS / multiple weekdays per month increment: a plain (no per-day
  // ordinal prefix) multi-value BYDAY plus a trailing BYSETPOS — the real
  // iCalendar encoding for "the Nth (or last) day among this set of
  // weekdays." Distinguishable from monthlyByWeekday above by construction:
  // that regex requires exactly one BYDAY value with a leading ordinal
  // digit baked into it (e.g. `3TU`) and no BYSETPOS at all, so it can
  // never match a string produced by this shape, and vice versa.
  const monthlyByWeekdaySet = /^FREQ=MONTHLY;(?:INTERVAL=(\d+);)?BYDAY=([A-Z,]+);BYSETPOS=(-?\d+)$/.exec(base);
  if (monthlyByWeekdaySet) {
    const codes = monthlyByWeekdaySet[2].split(',');
    const weekdaySet: number[] = [];
    for (const code of codes) {
      const index = BYDAY_CODES.indexOf(code);
      if (index === -1) return null;
      weekdaySet.push(index + 1);
    }
    const ordinal = Number(monthlyByWeekdaySet[3]);
    if (ordinal === 0 || ordinal < -1 || ordinal > 4) return null;
    const intervalMonths = monthlyByWeekdaySet[1] ? Number(monthlyByWeekdaySet[1]) : 1;
    if (intervalMonths < 1) return null;
    return { frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet, ordinal, intervalMonths, ...end };
  }

  return null;
}

// Every day in `date`'s month whose weekday is one of `weekdaySet`, in
// ascending date order — the "Nth day among a set of weekdays" shape counts
// through this list, not through the whole month. Shared by matchOccurrence
// below for both the shape check and (via its length/position) the
// occurrence-index math COUNT needs.
function daysInMonthMatchingWeekdaySet(date: DateTime, weekdaySet: number[]): number[] {
  const daysInMonth = date.daysInMonth ?? date.endOf('month').day;
  const matches: number[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    if (weekdaySet.includes(date.set({ day }).weekday)) {
      matches.push(day);
    }
  }
  return matches;
}

// Whether a given occurrence date matches the recurrence's own calendar
// shape (day-of-week / day-of-month / Nth-weekday / Nth-weekday-in-a-set,
// on the right cadence of days/weeks/months from `anchor`), and — when it
// does — that occurrence's own 0-based index (the 1st time it's ever
// recurred, the 2nd, ...). The index is what COUNT is checked against in
// isDueOn below; it's undefined exactly when it always was for these shapes
// before this increment (no anchor available), which is fine — COUNT
// simply can't be enforced without one, the same "can't verify, so don't
// claim due" instinct interval-N checks already use for a missing anchor.
function matchOccurrence(
  recurrence: HabitRecurrence,
  date: DateTime,
  anchor?: DateTime,
): { isDue: boolean; index?: number } {
  if (recurrence.frequency === 'DAILY') {
    if (recurrence.intervalDays === 1) {
      if (!anchor) return { isDue: true };
      const diff = Math.floor(date.startOf('day').diff(anchor.startOf('day'), 'days').days);
      return diff >= 0 ? { isDue: true, index: diff } : { isDue: false };
    }
    if (!anchor) return { isDue: false };
    const diff = Math.floor(date.startOf('day').diff(anchor.startOf('day'), 'days').days);
    if (diff < 0 || diff % recurrence.intervalDays !== 0) return { isDue: false };
    return { isDue: true, index: diff / recurrence.intervalDays };
  }

  if (recurrence.frequency === 'WEEKLY') {
    if (!recurrence.daysOfWeek.includes(date.weekday)) return { isDue: false };
    if (!anchor) {
      return recurrence.intervalWeeks === 1 ? { isDue: true } : { isDue: false };
    }
    // Luxon's `startOf('week')` is Monday-anchored (ISO 8601), matching the
    // ISO weekday numbering this whole file already uses — so both dates
    // are compared from the same Monday-start reference point regardless
    // of which day of that week each one actually falls on.
    const weekDiff = Math.floor(date.startOf('week').diff(anchor.startOf('week'), 'weeks').weeks);
    if (weekDiff < 0 || weekDiff % recurrence.intervalWeeks !== 0) return { isDue: false };
    // Each "active" week contributes one occurrence per selected weekday,
    // in weekday order — the index counts every prior active week's full
    // set, plus this date's own position within its week.
    const activeWeekIndex = weekDiff / recurrence.intervalWeeks;
    const sortedDays = [...recurrence.daysOfWeek].sort((a, b) => a - b);
    const positionInWeek = sortedDays.indexOf(date.weekday);
    return { isDue: true, index: activeWeekIndex * sortedDays.length + positionInWeek };
  }

  // MONTHLY — `date.daysInMonth` is typed as possibly undefined by Luxon
  // (it's only unset for an invalid DateTime), so it's resolved once here
  // with a same-month fallback rather than asserted away at each use below.
  const daysInMonth = date.daysInMonth ?? date.endOf('month').day;

  let matchesShape: boolean;
  if (recurrence.mode === 'DAY_OF_MONTH') {
    matchesShape =
      recurrence.dayOfMonth === -1
        ? date.day === daysInMonth
        : // A month with fewer days than the requested one (e.g. day 31 in
          // April) simply has no occurrence that month — real BYMONTHDAY
          // semantics, not clamped to the month's last day.
          date.day === recurrence.dayOfMonth;
  } else if (recurrence.mode === 'DAYS_OF_MONTH') {
    // Same "no occurrence that month" semantics as DAY_OF_MONTH above,
    // applied per day in the list — day 31 simply never matches in a
    // 30-day month, it isn't shifted to the 30th.
    matchesShape = recurrence.daysOfMonth.includes(date.day);
  } else if (recurrence.mode === 'NTH_WEEKDAY_SET') {
    const matches = daysInMonthMatchingWeekdaySet(date, recurrence.weekdaySet);
    const targetDay = recurrence.ordinal === -1 ? matches[matches.length - 1] : matches[recurrence.ordinal - 1];
    // Undefined exactly when the requested ordinal doesn't exist that month
    // (e.g. a weekday set narrow enough, and an ordinal high enough, that
    // there aren't that many matches) — real "no occurrence," not an error.
    matchesShape = targetDay !== undefined && date.day === targetDay;
  } else if (date.weekday !== recurrence.weekday) {
    matchesShape = false;
  } else if (recurrence.ordinal === -1) {
    // The last occurrence of this weekday in the month: true exactly when
    // there isn't another one 7 days later still inside the same month.
    matchesShape = date.day + 7 > daysInMonth;
  } else {
    matchesShape = Math.ceil(date.day / 7) === recurrence.ordinal;
  }
  if (!matchesShape) return { isDue: false };

  if (recurrence.intervalMonths === 1) {
    if (!anchor) return { isDue: true };
    const monthDiff = Math.floor(date.startOf('month').diff(anchor.startOf('month'), 'months').months);
    return monthDiff >= 0 ? { isDue: true, index: monthDiff } : { isDue: false };
  }
  if (!anchor) return { isDue: false };
  const monthDiff = Math.floor(date.startOf('month').diff(anchor.startOf('month'), 'months').months);
  if (monthDiff < 0 || monthDiff % recurrence.intervalMonths !== 0) return { isDue: false };
  return { isDue: true, index: monthDiff / recurrence.intervalMonths };
}

// Whether a habit with this RRULE is due on the given local calendar date.
// An unrecognized RRULE is treated as "not due" — silently guessing a habit
// is due (and showing a checkbox for it) is worse than silently not
// surfacing it, matching the same fail-closed instinct as the AI planner's
// policy layer dropping proposals it can't validate.
//
// `anchor` is the habit's own `createdAt`, converted to the same local zone
// as `date` — only needed (and only used) by the interval-N shapes (every N
// days / every N weeks / every N months) and by a COUNT-limited habit of
// any shape, since "every 3 days" (or "stop after 10 times") has to count
// from *some* fixed starting point, and there's no separately-chosen "start
// date" field in this API — the habit's own creation day is that anchor.
// A day before the habit was created is never due (a negative diff is
// filtered out), matching the same "the habit didn't exist yet" exclusion
// AnalyticsService's own streak/completion-rate window already applies.
// DAILY/WEEKLY/MONTHLY at their default interval of 1, with no COUNT set,
// don't need an anchor at all — they're a pure property of the calendar
// date itself — so every pre-existing call site that never passed one
// keeps working completely unchanged.
export function isDueOn(rrule: string, date: DateTime, anchor?: DateTime): boolean {
  const recurrence = parseRrule(rrule);
  if (!recurrence) return false;

  // UNTIL is a plain calendar-date cutoff, inclusive of that day — checked
  // as a plain ISO-date string comparison (lexical ordering on YYYY-MM-DD
  // strings is the same as calendar ordering), so it doesn't matter what
  // timezone `date` itself is expressed in.
  if (recurrence.until != null && date.toISODate()! > recurrence.until) return false;

  const occurrence = matchOccurrence(recurrence, date, anchor);
  if (!occurrence.isDue) return false;

  if (recurrence.count != null) {
    // Can't verify a fixed-count limit without knowing which numbered
    // occurrence this is — fails closed (not due) rather than guessing,
    // the same instinct an unrecognized RRULE already gets above.
    if (occurrence.index == null || occurrence.index >= recurrence.count) return false;
  }

  return true;
}
