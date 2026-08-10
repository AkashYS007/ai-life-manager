import { DateTime } from 'luxon';

// Computes the [start, end) of "today" in the user's own IANA timezone
// (users.timezone, Database Design Document §4.1) rather than the server's
// local time or naive UTC midnight — the same event at 11pm PST and one at
// 2am UTC the next calendar day must not both silently land on "today" or
// both get excluded, which is what happens if you only look at getHours()
// on a server-local Date (the shortcut TodayResolver's greeting still uses,
// which is fine for a greeting but not for correctly bucketing a person's
// calendar). Luxon is used rather than hand-rolled offset math because
// getting DST transitions right by hand is exactly the kind of thing a
// well-tested date library exists to avoid re-solving.
export function zonedDayBounds(date: Date, timezone: string): { start: Date; end: Date } {
  const zoned = DateTime.fromJSDate(date, { zone: timezone });
  const start = zoned.startOf('day');
  const end = start.plus({ days: 1 });
  return { start: start.toJSDate(), end: end.toJSDate() };
}
