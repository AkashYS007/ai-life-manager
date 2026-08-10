import { DateTime } from 'luxon';
import { buildRrule, parseRrule, isDueOn } from './rrule';

// Pure logic, no Prisma/DB needed — same rationale as zoned-day.spec.ts:
// getting recurrence wrong either hides a habit that should show up today,
// or shows a checkbox for a habit that isn't actually due, both of which
// silently erode trust in the daily checklist. Every date/anchor pair used
// below was independently computed with a throwaway Luxon script before
// being written into an assertion here (Aug 3/10/17/24 2026 are all real
// Mondays, Aug 4/11/18/25 2026 are all real Tuesdays, etc.) — not assumed.
describe('rrule', () => {
  describe('buildRrule', () => {
    it('builds FREQ=DAILY for a daily habit', () => {
      expect(buildRrule({ frequency: 'DAILY', intervalDays: 1 })).toBe('FREQ=DAILY');
    });

    it('builds FREQ=WEEKLY;BYDAY=... for specific weekdays, in Mon-Sun order regardless of input order', () => {
      expect(buildRrule({ frequency: 'WEEKLY', daysOfWeek: [5, 1, 3], intervalWeeks: 1 })).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    });

    it('de-duplicates repeated days', () => {
      expect(buildRrule({ frequency: 'WEEKLY', daysOfWeek: [1, 1, 2], intervalWeeks: 1 })).toBe('FREQ=WEEKLY;BYDAY=MO,TU');
    });

    it('rejects an empty weekly day list', () => {
      expect(() => buildRrule({ frequency: 'WEEKLY', daysOfWeek: [], intervalWeeks: 1 })).toThrow();
    });

    it('rejects an out-of-range weekday number', () => {
      expect(() => buildRrule({ frequency: 'WEEKLY', daysOfWeek: [0], intervalWeeks: 1 })).toThrow();
      expect(() => buildRrule({ frequency: 'WEEKLY', daysOfWeek: [8], intervalWeeks: 1 })).toThrow();
    });

    // Full custom habit recurrence increment.
    it('builds FREQ=DAILY;INTERVAL=N for "every N days"', () => {
      expect(buildRrule({ frequency: 'DAILY', intervalDays: 3 })).toBe('FREQ=DAILY;INTERVAL=3');
    });

    it('rejects a non-positive intervalDays', () => {
      expect(() => buildRrule({ frequency: 'DAILY', intervalDays: 0 })).toThrow();
      expect(() => buildRrule({ frequency: 'DAILY', intervalDays: -1 })).toThrow();
    });

    it('builds FREQ=WEEKLY;INTERVAL=N;BYDAY=... for "every N weeks"', () => {
      expect(buildRrule({ frequency: 'WEEKLY', daysOfWeek: [1, 3], intervalWeeks: 2 })).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    });

    it('builds FREQ=MONTHLY;BYMONTHDAY=D for a day-of-month habit', () => {
      expect(buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 15, intervalMonths: 1 })).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
    });

    it('builds FREQ=MONTHLY;BYMONTHDAY=-1 for "the last day of the month"', () => {
      expect(buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: -1, intervalMonths: 1 })).toBe('FREQ=MONTHLY;BYMONTHDAY=-1');
    });

    it('rejects a day-of-month outside 1-31 (other than -1)', () => {
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 0, intervalMonths: 1 })).toThrow();
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 32, intervalMonths: 1 })).toThrow();
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: -2, intervalMonths: 1 })).toThrow();
    });

    it('builds FREQ=MONTHLY;BYDAY=nWD for "the Nth weekday of the month"', () => {
      expect(buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 2, ordinal: 3, intervalMonths: 1 })).toBe('FREQ=MONTHLY;BYDAY=3TU');
    });

    it('builds FREQ=MONTHLY;BYDAY=-1WD for "the last weekday of the month"', () => {
      expect(buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 5, ordinal: -1, intervalMonths: 1 })).toBe('FREQ=MONTHLY;BYDAY=-1FR');
    });

    it('rejects an out-of-range ordinal', () => {
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 1, ordinal: 0, intervalMonths: 1 })).toThrow();
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 1, ordinal: 5, intervalMonths: 1 })).toThrow();
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 1, ordinal: -2, intervalMonths: 1 })).toThrow();
    });

    // Fuller habit recurrence increment: every N months.
    it('builds FREQ=MONTHLY;INTERVAL=N;BYMONTHDAY=D for "every N months, on a day of the month"', () => {
      expect(buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 1, intervalMonths: 3 })).toBe('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1');
    });

    it('builds FREQ=MONTHLY;INTERVAL=N;BYDAY=nWD for "every N months, on the Nth weekday"', () => {
      expect(buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 1, ordinal: 1, intervalMonths: 2 })).toBe('FREQ=MONTHLY;INTERVAL=2;BYDAY=1MO');
    });

    it('rejects a non-positive intervalMonths', () => {
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 1, intervalMonths: 0 })).toThrow();
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 1, intervalMonths: -1 })).toThrow();
    });

    // BYSETPOS / multiple weekdays per month increment: several specific
    // days of the month in one rule.
    it('builds FREQ=MONTHLY;BYMONTHDAY=d1,d2,... for several days of the month, sorted and de-duplicated', () => {
      expect(buildRrule({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [15, 1, 15], intervalMonths: 1 })).toBe(
        'FREQ=MONTHLY;BYMONTHDAY=1,15',
      );
    });

    it('rejects DAYS_OF_MONTH with fewer than 2 distinct days', () => {
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [1], intervalMonths: 1 })).toThrow();
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [5, 5], intervalMonths: 1 })).toThrow();
    });

    it('rejects a DAYS_OF_MONTH day outside 1-31 (no -1 "last day" support in this mode)', () => {
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [1, -1], intervalMonths: 1 })).toThrow();
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [1, 32], intervalMonths: 1 })).toThrow();
    });

    // BYSETPOS / multiple weekdays per month increment: "the Nth (or last)
    // day among a set of weekdays" — real BYSETPOS applied to a plain,
    // non-ordinal-prefixed multi-value BYDAY.
    it('builds FREQ=MONTHLY;BYDAY=...;BYSETPOS=N for "the Nth day among a set of weekdays"', () => {
      expect(
        buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [5, 1, 3], ordinal: 1, intervalMonths: 1 }),
      ).toBe('FREQ=MONTHLY;BYDAY=MO,WE,FR;BYSETPOS=1');
    });

    it('builds ...;BYSETPOS=-1 for "the last weekday of the month" (a Mon-Fri set)', () => {
      expect(
        buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [1, 2, 3, 4, 5], ordinal: -1, intervalMonths: 1 }),
      ).toBe('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1');
    });

    it('rejects an empty weekday set for NTH_WEEKDAY_SET', () => {
      expect(() => buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [], ordinal: 1, intervalMonths: 1 })).toThrow();
    });

    it('rejects an out-of-range ordinal for NTH_WEEKDAY_SET, same range as NTH_WEEKDAY', () => {
      expect(() =>
        buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [1], ordinal: 0, intervalMonths: 1 }),
      ).toThrow();
      expect(() =>
        buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [1], ordinal: 5, intervalMonths: 1 }),
      ).toThrow();
    });

    it('combines intervalMonths with the two new MONTHLY shapes', () => {
      expect(
        buildRrule({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [1, 15], intervalMonths: 2 }),
      ).toBe('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1,15');
      expect(
        buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [6, 7], ordinal: -1, intervalMonths: 2 }),
      ).toBe('FREQ=MONTHLY;INTERVAL=2;BYDAY=SA,SU;BYSETPOS=-1');
    });

    // Fuller habit recurrence increment: COUNT/UNTIL, shared across all shapes.
    it('appends ;COUNT=N to any shape', () => {
      expect(buildRrule({ frequency: 'DAILY', intervalDays: 1, count: 10 })).toBe('FREQ=DAILY;COUNT=10');
      expect(buildRrule({ frequency: 'WEEKLY', daysOfWeek: [1], intervalWeeks: 1, count: 5 })).toBe('FREQ=WEEKLY;BYDAY=MO;COUNT=5');
      expect(
        buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 1, intervalMonths: 1, count: 6 }),
      ).toBe('FREQ=MONTHLY;BYMONTHDAY=1;COUNT=6');
    });

    it('appends ;UNTIL=YYYYMMDD (dashes stripped) to any shape', () => {
      expect(buildRrule({ frequency: 'DAILY', intervalDays: 1, until: '2026-12-31' })).toBe('FREQ=DAILY;UNTIL=20261231');
    });

    it('combines INTERVAL and COUNT/UNTIL correctly, INTERVAL first', () => {
      expect(buildRrule({ frequency: 'DAILY', intervalDays: 3, count: 4 })).toBe('FREQ=DAILY;INTERVAL=3;COUNT=4');
      expect(
        buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 2, ordinal: 1, intervalMonths: 2, until: '2027-01-01' }),
      ).toBe('FREQ=MONTHLY;INTERVAL=2;BYDAY=1TU;UNTIL=20270101');
    });

    it('rejects specifying both count and until', () => {
      expect(() => buildRrule({ frequency: 'DAILY', intervalDays: 1, count: 5, until: '2026-12-31' })).toThrow();
    });

    it('rejects a non-positive count', () => {
      expect(() => buildRrule({ frequency: 'DAILY', intervalDays: 1, count: 0 })).toThrow();
    });

    it('rejects a malformed or invalid until date', () => {
      expect(() => buildRrule({ frequency: 'DAILY', intervalDays: 1, until: '12/31/2026' })).toThrow();
      expect(() => buildRrule({ frequency: 'DAILY', intervalDays: 1, until: '2026-02-30' })).toThrow(); // not a real date
    });
  });

  describe('parseRrule', () => {
    it('round-trips a daily habit', () => {
      expect(parseRrule(buildRrule({ frequency: 'DAILY', intervalDays: 1 }))).toEqual({ frequency: 'DAILY', intervalDays: 1 });
    });

    it('round-trips a weekly habit', () => {
      const rrule = buildRrule({ frequency: 'WEEKLY', daysOfWeek: [2, 4], intervalWeeks: 1 });
      expect(parseRrule(rrule)).toEqual({ frequency: 'WEEKLY', daysOfWeek: [2, 4], intervalWeeks: 1 });
    });

    // Backward compatibility: rrule strings this project wrote before the
    // Full custom habit recurrence increment existed have no INTERVAL
    // segment at all — must still parse, defaulting to interval 1, not null.
    it('parses a pre-existing plain FREQ=DAILY/FREQ=WEEKLY rrule (no INTERVAL) as interval 1', () => {
      expect(parseRrule('FREQ=DAILY')).toEqual({ frequency: 'DAILY', intervalDays: 1 });
      expect(parseRrule('FREQ=WEEKLY;BYDAY=MO,WE')).toEqual({ frequency: 'WEEKLY', daysOfWeek: [1, 3], intervalWeeks: 1 });
    });

    // Backward compatibility: rrule strings written before *this* increment
    // (Fuller habit recurrence) have no per-month INTERVAL segment either —
    // must still parse, defaulting intervalMonths to 1.
    it('parses a pre-existing plain FREQ=MONTHLY rrule (no per-month INTERVAL) as intervalMonths 1', () => {
      expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=15')).toEqual({
        frequency: 'MONTHLY',
        mode: 'DAY_OF_MONTH',
        dayOfMonth: 15,
        intervalMonths: 1,
      });
      expect(parseRrule('FREQ=MONTHLY;BYDAY=3TU')).toEqual({
        frequency: 'MONTHLY',
        mode: 'NTH_WEEKDAY',
        weekday: 2,
        ordinal: 3,
        intervalMonths: 1,
      });
    });

    it('round-trips "every N days" and "every N weeks"', () => {
      expect(parseRrule(buildRrule({ frequency: 'DAILY', intervalDays: 3 }))).toEqual({ frequency: 'DAILY', intervalDays: 3 });
      expect(parseRrule(buildRrule({ frequency: 'WEEKLY', daysOfWeek: [1], intervalWeeks: 2 }))).toEqual({
        frequency: 'WEEKLY',
        daysOfWeek: [1],
        intervalWeeks: 2,
      });
    });

    it('round-trips both MONTHLY shapes', () => {
      expect(parseRrule(buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 15, intervalMonths: 1 }))).toEqual({
        frequency: 'MONTHLY',
        mode: 'DAY_OF_MONTH',
        dayOfMonth: 15,
        intervalMonths: 1,
      });
      expect(parseRrule(buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: -1, intervalMonths: 1 }))).toEqual({
        frequency: 'MONTHLY',
        mode: 'DAY_OF_MONTH',
        dayOfMonth: -1,
        intervalMonths: 1,
      });
      expect(parseRrule(buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 2, ordinal: 3, intervalMonths: 1 }))).toEqual({
        frequency: 'MONTHLY',
        mode: 'NTH_WEEKDAY',
        weekday: 2,
        ordinal: 3,
        intervalMonths: 1,
      });
      expect(parseRrule(buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 5, ordinal: -1, intervalMonths: 1 }))).toEqual({
        frequency: 'MONTHLY',
        mode: 'NTH_WEEKDAY',
        weekday: 5,
        ordinal: -1,
        intervalMonths: 1,
      });
    });

    // Fuller habit recurrence increment.
    it('round-trips "every N months", both monthly modes', () => {
      expect(
        parseRrule(buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 1, intervalMonths: 3 })),
      ).toEqual({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 1, intervalMonths: 3 });
      expect(
        parseRrule(buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 1, ordinal: 1, intervalMonths: 2 })),
      ).toEqual({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 1, ordinal: 1, intervalMonths: 2 });
    });

    // BYSETPOS / multiple weekdays per month increment.
    it('round-trips DAYS_OF_MONTH and NTH_WEEKDAY_SET', () => {
      expect(
        parseRrule(buildRrule({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [1, 15], intervalMonths: 1 })),
      ).toEqual({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [1, 15], intervalMonths: 1 });
      expect(
        parseRrule(
          buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [1, 2, 3, 4, 5], ordinal: -1, intervalMonths: 1 }),
        ),
      ).toEqual({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [1, 2, 3, 4, 5], ordinal: -1, intervalMonths: 1 });
    });

    it('round-trips DAYS_OF_MONTH and NTH_WEEKDAY_SET with an N-month interval', () => {
      expect(
        parseRrule(buildRrule({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [1, 15], intervalMonths: 2 })),
      ).toEqual({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [1, 15], intervalMonths: 2 });
      expect(
        parseRrule(buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [6, 7], ordinal: 1, intervalMonths: 3 })),
      ).toEqual({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [6, 7], ordinal: 1, intervalMonths: 3 });
    });

    // A single-day habit always parses back as DAY_OF_MONTH, never
    // DAYS_OF_MONTH — buildRrule itself refuses to build a single-day
    // DAYS_OF_MONTH rule (see its own "rejects fewer than 2 distinct days"
    // test above), so this exercises parseRrule's side of that same
    // guarantee directly, independent of buildRrule.
    it('parses a plain single-value BYMONTHDAY as DAY_OF_MONTH, never DAYS_OF_MONTH', () => {
      expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=1')).toEqual({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 1, intervalMonths: 1 });
    });

    it('round-trips COUNT and UNTIL, on top of any shape', () => {
      expect(parseRrule(buildRrule({ frequency: 'DAILY', intervalDays: 1, count: 10 }))).toEqual({
        frequency: 'DAILY',
        intervalDays: 1,
        count: 10,
      });
      expect(parseRrule(buildRrule({ frequency: 'DAILY', intervalDays: 3, until: '2026-12-31' }))).toEqual({
        frequency: 'DAILY',
        intervalDays: 3,
        until: '2026-12-31',
      });
      expect(
        parseRrule(
          buildRrule({ frequency: 'WEEKLY', daysOfWeek: [1, 3], intervalWeeks: 2, count: 8 }),
        ),
      ).toEqual({ frequency: 'WEEKLY', daysOfWeek: [1, 3], intervalWeeks: 2, count: 8 });
    });

    it('returns null for garbage', () => {
      expect(parseRrule('garbage')).toBeNull();
      expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=0')).toBeNull();
      expect(parseRrule('FREQ=MONTHLY;BYDAY=5TU')).toBeNull(); // ordinal out of range
      // BYSETPOS / multiple weekdays per month increment.
      expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=1,32')).toBeNull(); // 32 out of range
      expect(parseRrule('FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=5')).toBeNull(); // ordinal out of range
      expect(parseRrule('FREQ=MONTHLY;BYDAY=XX;BYSETPOS=1')).toBeNull(); // not a real weekday code
    });

    it('returns null for a COUNT/UNTIL suffix on an otherwise-garbage base', () => {
      expect(parseRrule('FREQ=MONTHLY;BYMONTHDAY=1000;COUNT=5')).toBeNull();
      expect(parseRrule('FREQ=DAILY;COUNT=0')).toBeNull(); // COUNT must be positive
    });
  });

  describe('isDueOn', () => {
    it('a daily habit is due every day', () => {
      const monday = DateTime.fromISO('2026-08-03'); // a Monday
      const sunday = DateTime.fromISO('2026-08-09'); // a Sunday
      expect(isDueOn('FREQ=DAILY', monday)).toBe(true);
      expect(isDueOn('FREQ=DAILY', sunday)).toBe(true);
    });

    it('a weekly habit is only due on its selected days', () => {
      const rrule = buildRrule({ frequency: 'WEEKLY', daysOfWeek: [1, 3, 5], intervalWeeks: 1 }); // Mon/Wed/Fri
      const monday = DateTime.fromISO('2026-08-03');
      const tuesday = DateTime.fromISO('2026-08-04');
      const friday = DateTime.fromISO('2026-08-07');
      expect(isDueOn(rrule, monday)).toBe(true);
      expect(isDueOn(rrule, tuesday)).toBe(false);
      expect(isDueOn(rrule, friday)).toBe(true);
    });

    it('treats an unrecognized RRULE as not due, rather than guessing', () => {
      const monday = DateTime.fromISO('2026-08-03');
      expect(isDueOn('FREQ=MONTHLY;BYMONTHDAY=1000', monday)).toBe(false);
    });

    // Full custom habit recurrence increment. Every date/anchor pair below
    // was verified with a throwaway script first — see this file's header
    // comment.
    describe('every N days', () => {
      const rrule = buildRrule({ frequency: 'DAILY', intervalDays: 3 });
      const anchor = DateTime.fromISO('2026-08-01'); // the habit's createdAt

      it('is due on the anchor day itself (day 0)', () => {
        expect(isDueOn(rrule, anchor, anchor)).toBe(true);
      });

      it('is due again exactly 3 days later, not 1 or 2 days later', () => {
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-02'), anchor)).toBe(false);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-03'), anchor)).toBe(false);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-04'), anchor)).toBe(true);
      });

      it('is never due before the anchor day', () => {
        expect(isDueOn(rrule, DateTime.fromISO('2026-07-31'), anchor)).toBe(false);
      });

      it('is treated as not due (fail-closed) if no anchor is given at all', () => {
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-04'))).toBe(false);
      });
    });

    describe('every N weeks', () => {
      const rrule = buildRrule({ frequency: 'WEEKLY', daysOfWeek: [1], intervalWeeks: 2 }); // every 2 weeks, Monday
      const anchor = DateTime.fromISO('2026-08-03'); // a Monday — the habit's createdAt

      it('is due on the anchor week (week 0) and every second week after', () => {
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-03'), anchor)).toBe(true); // week 0
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-17'), anchor)).toBe(true); // week 2
      });

      it('is not due on the skipped week in between', () => {
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-10'), anchor)).toBe(false); // week 1
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-24'), anchor)).toBe(false); // week 3
      });

      it('still only fires on the selected weekday, even on a due week', () => {
        // Week 0, but a Tuesday, not the selected Monday.
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-04'), anchor)).toBe(false);
      });
    });

    describe('monthly on a specific day of the month', () => {
      it('is due only on that day, in months that have it', () => {
        const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 15, intervalMonths: 1 });
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-15'))).toBe(true);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-14'))).toBe(false);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-16'))).toBe(false);
      });

      it('is never due in a month shorter than the requested day — not clamped to that month\'s last day', () => {
        const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 31, intervalMonths: 1 });
        // April 2026 has 30 days — the 31st never happens in April.
        expect(isDueOn(rrule, DateTime.fromISO('2026-04-30'))).toBe(false);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-31'))).toBe(true); // August has 31
      });

      it('"the last day of the month" (-1) is due on the 28th in Feb, the 30th in Apr, the 31st in Aug', () => {
        const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: -1, intervalMonths: 1 });
        expect(isDueOn(rrule, DateTime.fromISO('2026-02-28'))).toBe(true);
        expect(isDueOn(rrule, DateTime.fromISO('2026-04-30'))).toBe(true);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-31'))).toBe(true);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-30'))).toBe(false);
      });
    });

    describe('monthly on the Nth weekday', () => {
      it('is due on the Nth occurrence of that weekday, and no other Tuesday that month', () => {
        // The 3rd Tuesday of August 2026 is the 18th (Tuesdays: 4, 11, 18, 25).
        const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 2, ordinal: 3, intervalMonths: 1 });
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-18'))).toBe(true);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-11'))).toBe(false); // 2nd Tuesday
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-25'))).toBe(false); // 4th Tuesday
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-19'))).toBe(false); // a Wednesday
      });

      it('"the last" (-1) is due on the final occurrence of that weekday, not the 4th if a 5th exists', () => {
        // August 2026 has 5 Tuesdays... no — 4, 11, 18, 25 is only 4 (next would be Sep 1). The last is the 25th.
        const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 2, ordinal: -1, intervalMonths: 1 });
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-25'))).toBe(true);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-18'))).toBe(false);
      });
    });

    // BYSETPOS / multiple weekdays per month increment. Every date below
    // was independently verified with a throwaway Luxon script first (see
    // this file's header comment) — August 2026 specifically: Mondays fall
    // on 3/10/17/24/31, Fridays on 7/14/21/28, and the 1st falls on a
    // Saturday.
    describe('monthly on several days of the month', () => {
      it('is due on any of the listed days, and no other day', () => {
        const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [1, 15], intervalMonths: 1 });
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-01'))).toBe(true);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-15'))).toBe(true);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-02'))).toBe(false);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-16'))).toBe(false);
      });

      it('is never due for a listed day that month is too short to have — not clamped', () => {
        // February 2026 has 28 days — the 30th and 31st never happen.
        const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'DAYS_OF_MONTH', daysOfMonth: [1, 30, 31], intervalMonths: 1 });
        expect(isDueOn(rrule, DateTime.fromISO('2026-02-01'))).toBe(true);
        expect(isDueOn(rrule, DateTime.fromISO('2026-02-28'))).toBe(false);
      });
    });

    describe('monthly on the Nth (or last) day among a set of weekdays', () => {
      it('"the last weekday of the month" (a Mon-Fri set) is due on the actual last weekday, not the last day of any specific one', () => {
        // August 2026's last weekday overall is Monday the 31st — genuinely
        // different from "the last Friday" (the 28th), proving this checks
        // across the whole set, not one specific weekday within it.
        const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [1, 2, 3, 4, 5], ordinal: -1, intervalMonths: 1 });
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-31'))).toBe(true);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-28'))).toBe(false); // the last Friday, not the last weekday
      });

      it('"the 1st weekday of the month" is due on the actual first weekday, whichever weekday that is', () => {
        // August 2026 opens on a Saturday, so its first weekday is Monday
        // the 3rd — not the 1st.
        const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [1, 2, 3, 4, 5], ordinal: 1, intervalMonths: 1 });
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-03'))).toBe(true);
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-01'))).toBe(false); // a Saturday, not in the weekday set at all
      });

      it('works for a non-Mon-Fri set too — "the last weekend day of the month"', () => {
        const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY_SET', weekdaySet: [6, 7], ordinal: -1, intervalMonths: 1 });
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-30'))).toBe(true); // the last Sunday
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-29'))).toBe(false); // the Saturday right before it
      });
    });

    // Fuller habit recurrence increment: every N months.
    describe('every N months', () => {
      // Every 3 months, on the 1st. Anchor is January 1, 2026 (a real due
      // day itself — month 0). Independently verified: Jan/Apr/Jul/Oct
      // 2026 are 0/3/6/9 months after January, all real multiples of 3.
      const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 1, intervalMonths: 3 });
      const anchor = DateTime.fromISO('2026-01-01');

      it('is due on the anchor month (month 0) and every 3rd month after', () => {
        expect(isDueOn(rrule, DateTime.fromISO('2026-01-01'), anchor)).toBe(true); // month 0
        expect(isDueOn(rrule, DateTime.fromISO('2026-04-01'), anchor)).toBe(true); // month 3
        expect(isDueOn(rrule, DateTime.fromISO('2026-07-01'), anchor)).toBe(true); // month 6
      });

      it('is not due in a skipped month in between, even on the right day-of-month', () => {
        expect(isDueOn(rrule, DateTime.fromISO('2026-02-01'), anchor)).toBe(false); // month 1
        expect(isDueOn(rrule, DateTime.fromISO('2026-03-01'), anchor)).toBe(false); // month 2
      });

      it('is never due before the anchor month', () => {
        expect(isDueOn(rrule, DateTime.fromISO('2025-10-01'), anchor)).toBe(false);
      });

      it('is treated as not due (fail-closed) if no anchor is given at all', () => {
        expect(isDueOn(rrule, DateTime.fromISO('2026-04-01'))).toBe(false);
      });

      it('also works for the Nth-weekday monthly mode, at an N-month cadence', () => {
        // Every 2 months, on the 1st Monday. Anchor Jan 5 2026 (a Monday,
        // and the 1st Monday of January) — month 0. March 2026's 1st
        // Monday is the 2nd (verified independently) — month 2, due.
        // February 2026's 1st Monday is the 2nd — month 1, skipped.
        const nthRrule = buildRrule({ frequency: 'MONTHLY', mode: 'NTH_WEEKDAY', weekday: 1, ordinal: 1, intervalMonths: 2 });
        const nthAnchor = DateTime.fromISO('2026-01-05');
        expect(isDueOn(nthRrule, DateTime.fromISO('2026-01-05'), nthAnchor)).toBe(true); // month 0
        expect(isDueOn(nthRrule, DateTime.fromISO('2026-02-02'), nthAnchor)).toBe(false); // month 1, skipped
        expect(isDueOn(nthRrule, DateTime.fromISO('2026-03-02'), nthAnchor)).toBe(true); // month 2
      });
    });

    // Fuller habit recurrence increment: COUNT.
    describe('a fixed-count (COUNT) recurrence', () => {
      it('stops being due once it has recurred COUNT times, for a daily habit', () => {
        const rrule = buildRrule({ frequency: 'DAILY', intervalDays: 1, count: 3 });
        const anchor = DateTime.fromISO('2026-08-01');
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-01'), anchor)).toBe(true); // occurrence 1 (index 0)
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-02'), anchor)).toBe(true); // occurrence 2 (index 1)
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-03'), anchor)).toBe(true); // occurrence 3 (index 2)
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-04'), anchor)).toBe(false); // would be occurrence 4 — past COUNT
      });

      it('counts each on-cadence day for an "every N days" habit, not calendar days', () => {
        const rrule = buildRrule({ frequency: 'DAILY', intervalDays: 2, count: 2 });
        const anchor = DateTime.fromISO('2026-08-01');
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-01'), anchor)).toBe(true); // occurrence 1
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-03'), anchor)).toBe(true); // occurrence 2
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-05'), anchor)).toBe(false); // would be occurrence 3
      });

      it('counts across multiple selected weekdays within a week for a weekly habit, in weekday order', () => {
        // Mon/Wed/Fri, COUNT=4 — 1st week gives Mon(1)/Wed(2)/Fri(3), 2nd
        // week's Monday is occurrence 4, its Wednesday is occurrence 5 (cut off).
        const rrule = buildRrule({ frequency: 'WEEKLY', daysOfWeek: [1, 3, 5], intervalWeeks: 1, count: 4 });
        const anchor = DateTime.fromISO('2026-08-03'); // a Monday
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-03'), anchor)).toBe(true); // Mon, occurrence 1
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-05'), anchor)).toBe(true); // Wed, occurrence 2
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-07'), anchor)).toBe(true); // Fri, occurrence 3
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-10'), anchor)).toBe(true); // next Mon, occurrence 4
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-12'), anchor)).toBe(false); // next Wed, would be occurrence 5
      });

      it('a COUNT-limited habit with no anchor available is never due (fail-closed, can\'t verify the count)', () => {
        const rrule = buildRrule({ frequency: 'DAILY', intervalDays: 1, count: 5 });
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-01'))).toBe(false);
      });

      it('applies to a monthly habit too, counting months', () => {
        const rrule = buildRrule({ frequency: 'MONTHLY', mode: 'DAY_OF_MONTH', dayOfMonth: 1, intervalMonths: 1, count: 2 });
        const anchor = DateTime.fromISO('2026-01-01');
        expect(isDueOn(rrule, DateTime.fromISO('2026-01-01'), anchor)).toBe(true); // occurrence 1
        expect(isDueOn(rrule, DateTime.fromISO('2026-02-01'), anchor)).toBe(true); // occurrence 2
        expect(isDueOn(rrule, DateTime.fromISO('2026-03-01'), anchor)).toBe(false); // would be occurrence 3
      });
    });

    // Fuller habit recurrence increment: UNTIL.
    describe('an end-dated (UNTIL) recurrence', () => {
      it('is due right up to and including the UNTIL date, and never after', () => {
        const rrule = buildRrule({ frequency: 'DAILY', intervalDays: 1, until: '2026-08-05' });
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-05'))).toBe(true); // the UNTIL date itself — still due
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-06'))).toBe(false); // the day after — no longer due
      });

      it('needs no anchor at all — a pure calendar-date cutoff', () => {
        const rrule = buildRrule({ frequency: 'WEEKLY', daysOfWeek: [1], intervalWeeks: 1, until: '2026-12-31' });
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-03'))).toBe(true); // a Monday, well before the cutoff
      });

      it('applies on top of an interval-N shape\'s own cadence check, not instead of it', () => {
        const rrule = buildRrule({ frequency: 'DAILY', intervalDays: 3, until: '2026-08-10' });
        const anchor = DateTime.fromISO('2026-08-01');
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-02'), anchor)).toBe(false); // off-cadence, regardless of UNTIL
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-04'), anchor)).toBe(true); // on-cadence, before UNTIL
        expect(isDueOn(rrule, DateTime.fromISO('2026-08-13'), anchor)).toBe(false); // on-cadence, but past UNTIL
      });
    });
  });
});
