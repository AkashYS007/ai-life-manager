import { DateTime } from 'luxon';

export interface IcsFields {
  uid?: string;
  summary?: string;
  status?: string;
  dtstart?: string;
  dtend?: string;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function unescapeIcsText(text: string): string {
  return text.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// Minimal single-VEVENT field extraction — line-based, not a full RFC 5545
// parser, same "simple subset first" precedent as habits/rrule.ts's
// hand-written RRULE subset. Reads only the handful of properties this app
// actually needs (UID, SUMMARY, DTSTART, DTEND, STATUS) and does not expand
// recurring events — an RRULE inside a VEVENT is left alone, so a recurring
// Apple calendar event syncs in as its one anchor occurrence, not every
// future instance. See README for why this is an acceptable v1 scope.
export function parseIcsFields(rawIcsData: string): IcsFields {
  const ics = unescapeXml(rawIcsData);
  // Unfold folded lines (RFC 5545 §3.1: a line starting with a space or tab
  // is a continuation of the previous line, inserted by servers/clients to
  // keep individual lines short).
  const unfolded = ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n/);

  const fields: IcsFields = {};
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const rawName = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1);
    const name = rawName.split(';')[0].toUpperCase();

    switch (name) {
      case 'UID':
        fields.uid = value;
        break;
      case 'SUMMARY':
        fields.summary = unescapeIcsText(value);
        break;
      case 'STATUS':
        fields.status = value.toUpperCase();
        break;
      case 'DTSTART':
        fields.dtstart = value;
        break;
      case 'DTEND':
        fields.dtend = value;
        break;
    }
  }
  return fields;
}

// Parses an ICS DTSTART/DTEND value into a real Date. Handles the two
// common, unambiguous forms: a UTC instant (YYYYMMDDTHHMMSSZ) and an
// all-day date-only value (YYYYMMDD, from VALUE=DATE — signaled by the
// absence of a "T"). A local time with a TZID parameter
// (YYYYMMDDTHHMMSS, no trailing Z) is a real RFC 5545 form this does *not*
// fully handle — correct handling needs the event's VTIMEZONE block, out of
// scope for a first pass — so that form is interpreted in the account
// owner's own configured app timezone as a documented best-effort
// approximation (usually closer to correct than assuming UTC, since a
// personal iCloud calendar's events are usually created in the owner's own
// local zone).
export function parseIcsDate(value: string, fallbackTimezone: string): Date {
  if (/^\d{8}$/.test(value)) {
    const year = value.slice(0, 4);
    const month = value.slice(4, 6);
    const day = value.slice(6, 8);
    return new Date(`${year}-${month}-${day}T00:00:00Z`);
  }
  if (value.endsWith('Z')) {
    const iso = value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    return new Date(iso);
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!match) return new Date(NaN);
  const [, y, mo, d, h, mi, s] = match;
  return DateTime.fromISO(`${y}-${mo}-${d}T${h}:${mi}:${s}`, { zone: fallbackTimezone }).toJSDate();
}
