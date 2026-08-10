import { parseIcsFields, parseIcsDate } from './ics-parser';

// Pure logic, no Prisma/DB or network needed — same rationale as
// habits/rrule.spec.ts: getting the date math wrong here silently shifts
// every synced Apple Calendar event by however many hours are involved,
// exactly the class of bug the Microsoft sync increment's UTC-parsing test
// was written to catch.
describe('ics-parser', () => {
  describe('parseIcsFields', () => {
    it('extracts UID, SUMMARY, DTSTART, DTEND from a minimal VEVENT', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:abc-123',
        'SUMMARY:Team sync',
        'DTSTART:20260805T140000Z',
        'DTEND:20260805T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      expect(parseIcsFields(ics)).toEqual({
        uid: 'abc-123',
        summary: 'Team sync',
        dtstart: '20260805T140000Z',
        dtend: '20260805T150000Z',
      });
    });

    it('unescapes ICS text escaping in SUMMARY (commas, semicolons, backslash-n)', () => {
      const ics = 'BEGIN:VEVENT\r\nSUMMARY:Doctor\\, dentist\\; and lunch\\nbreak\r\nEND:VEVENT';
      expect(parseIcsFields(ics).summary).toBe('Doctor, dentist; and lunch break');
    });

    it('unfolds a folded line before extracting its value', () => {
      // RFC 5545 §3.1: a continuation line starts with a single space.
      const ics = 'BEGIN:VEVENT\r\nSUMMARY:This is a long summary that got\r\n  folded onto a second line\r\nEND:VEVENT';
      expect(parseIcsFields(ics).summary).toBe('This is a long summary that got folded onto a second line');
    });

    it('reads STATUS and uppercases it', () => {
      const ics = 'BEGIN:VEVENT\r\nSTATUS:cancelled\r\nEND:VEVENT';
      expect(parseIcsFields(ics).status).toBe('CANCELLED');
    });

    it('ignores DTSTART/DTEND parameters (e.g. TZID) when extracting the property name', () => {
      const ics = 'BEGIN:VEVENT\r\nDTSTART;TZID=America/New_York:20260805T090000\r\nEND:VEVENT';
      expect(parseIcsFields(ics).dtstart).toBe('20260805T090000');
    });
  });

  describe('parseIcsDate', () => {
    it('parses a UTC instant (trailing Z) exactly, ignoring the fallback timezone', () => {
      const date = parseIcsDate('20260805T140000Z', 'America/Los_Angeles');
      expect(date.toISOString()).toBe('2026-08-05T14:00:00.000Z');
    });

    it('parses an all-day date-only value as UTC midnight', () => {
      const date = parseIcsDate('20260805', 'America/Los_Angeles');
      expect(date.toISOString()).toBe('2026-08-05T00:00:00.000Z');
    });

    it('parses a local (no-Z) time in the given fallback timezone, not as UTC', () => {
      // 9am in America/New_York in August (EDT, UTC-4) is 13:00 UTC — if
      // this were wrongly treated as already-UTC, it would come out as
      // 09:00 UTC instead, a 4-hour bug of exactly the kind the Microsoft
      // sync increment's own UTC-parsing test guards against.
      const date = parseIcsDate('20260805T090000', 'America/New_York');
      expect(date.toISOString()).toBe('2026-08-05T13:00:00.000Z');
    });

    it('returns an invalid Date for unparseable input rather than throwing', () => {
      const date = parseIcsDate('not-a-date', 'UTC');
      expect(Number.isNaN(date.getTime())).toBe(true);
    });
  });
});
