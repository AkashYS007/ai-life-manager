import { zonedDayBounds } from './zoned-day';

// Pure logic, no Prisma/DB needed — the highest-value thing to actually
// unit test in this increment, since getting a timezone boundary wrong
// silently mis-buckets someone's calendar events onto the wrong day.
describe('zonedDayBounds', () => {
  it('returns UTC midnight-to-midnight when the zone is UTC', () => {
    const { start, end } = zonedDayBounds(new Date('2026-03-15T14:30:00Z'), 'UTC');
    expect(start.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-16T00:00:00.000Z');
  });

  it('shifts the day boundary for a negative-offset timezone', () => {
    // 2026-03-15T04:00:00Z is 2026-03-14 21:00 in America/Los_Angeles (UTC-7,
    // PDT already in effect by mid-March) — still "yesterday" locally.
    const { start, end } = zonedDayBounds(new Date('2026-03-15T04:00:00Z'), 'America/Los_Angeles');
    expect(start.toISOString()).toBe('2026-03-14T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-15T07:00:00.000Z');
  });

  it('produces exactly a 24-hour span even across a DST transition', () => {
    // US DST starts 2026-03-08 in America/New_York — the local day is still
    // wall-clock 24h (00:00 to 00:00 local) even though the UTC gap is 23h.
    const { start, end } = zonedDayBounds(new Date('2026-03-08T12:00:00Z'), 'America/New_York');
    const spanMs = end.getTime() - start.getTime();
    expect(spanMs).toBe(23 * 60 * 60 * 1000);
  });

  it('keeps a same-day UTC event out of the neighboring local day', () => {
    const { start, end } = zonedDayBounds(new Date('2026-06-01T12:00:00Z'), 'Asia/Tokyo');
    // Tokyo is UTC+9 — noon UTC is already 21:00 local the same June 1st.
    expect(start.toISOString()).toBe('2026-05-31T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-01T15:00:00.000Z');
  });
});
