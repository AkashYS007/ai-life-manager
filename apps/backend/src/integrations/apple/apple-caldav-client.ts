import { Injectable } from '@nestjs/common';
import { parseIcsFields } from './ics-parser';

const CALDAV_BASE = 'https://caldav.icloud.com';

export interface AppleCalendarEvent {
  href: string;
  removed: boolean; // true when this href came back with a 404 in a sync-collection response (RFC 6578 §3.8) — Apple's equivalent of Google's 'cancelled' status or Microsoft's `@removed` marker
  uid?: string;
  summary?: string;
  status?: string;
  dtstart?: string; // raw ICS value — parsed by the caller via ics-parser.ts's parseIcsDate, which needs the account owner's timezone that this client doesn't have
  dtend?: string;
}

export interface ListEventsResult {
  events: AppleCalendarEvent[];
  nextSyncToken?: string;
  fullResyncRequired: boolean;
}

export class AppleAuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AppleAuthError';
  }
}

function basicAuthHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

// Regex-based multistatus XML extraction rather than a full XML parser —
// same "simple subset first" reasoning as habits/rrule.ts's hand-written
// RRULE subset: this client only ever sends the handful of specific
// PROPFIND/REPORT requests below, so Apple's responses have a narrow,
// predictable shape. A general-purpose XML parser (a new dependency) would
// buy correctness for cases — arbitrary attribute/namespace-prefix
// ordering, CDATA sections, nested unrelated elements — that never come up
// for these specific requests, at the cost of a dependency nobody else in
// this codebase needs. Tag matching ignores any XML namespace prefix
// (`D:`, `d:`, `cal:`, etc.) since different CalDAV servers/proxies are
// inconsistent about which prefix they use for the same element.
function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<[^:>]*:?${tag}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${tag}>`, 'gi');
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) matches.push(m[1]);
  return matches;
}

function extractOne(xml: string, tag: string): string | undefined {
  return extractAll(xml, tag)[0];
}

// CalDAV (RFC 4791, built on WebDAV/RFC 4918) is a fundamentally different
// protocol shape than Google/Microsoft's JSON REST APIs: PROPFIND/REPORT
// methods instead of GET/POST, XML request/response bodies instead of
// JSON, and no OAuth — authentication is HTTP Basic Auth with an
// app-specific password (see README for how to generate one). This client
// hand-rolls the small number of requests this app actually needs rather
// than depending on a general CalDAV library.
@Injectable()
export class AppleCaldavClient {
  private async request(
    url: string,
    method: string,
    username: string,
    password: string,
    body: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; text: string }> {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: basicAuthHeader(username, password),
        'Content-Type': 'application/xml; charset=utf-8',
        ...extraHeaders,
      },
      body,
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      // TEMPORARY diagnostic — this is the very first live request this
      // hand-rolled CalDAV client has made to a real Apple server (see the
      // README's own admission), so a raw 401/403 here is genuinely
      // ambiguous: wrong appleId/app-specific password vs. a web-only
      // (no-device-ever-used) Apple Account being rejected by CalDAV auth
      // itself, vs. some other Apple-side quirk. Print exactly what Apple's
      // server said so this gets root-caused from real evidence instead of
      // guessed. Remove once this is resolved.
      // eslint-disable-next-line no-console
      console.log(
        `[APPLE CALDAV DEBUG] ${res.status} from ${url}\nWWW-Authenticate: ${res.headers.get('www-authenticate')}\nBody:\n${text}`,
      );
      throw new AppleAuthError(res.status, text);
    }
    return { status: res.status, text };
  }

  // Step 1 of connect(): resolve this account's principal URL — CalDAV has
  // no fixed per-user calendar URL the way Google/Microsoft's REST APIs do,
  // so every account needs this discovery chain once.
  async discoverPrincipal(username: string, password: string): Promise<string> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop><D:current-user-principal/></D:prop>
</D:propfind>`;
    const { text } = await this.request(`${CALDAV_BASE}/`, 'PROPFIND', username, password, body, { Depth: '0' });
    const href = extractOne(text, 'href');
    if (!href) throw new Error('Apple CalDAV: could not discover the account principal URL.');
    return href.startsWith('http') ? href : `${CALDAV_BASE}${href}`;
  }

  // Step 2: resolve the calendar-home-set — the collection that contains
  // this account's actual calendars.
  async discoverCalendarHome(principalUrl: string, username: string, password: string): Promise<string> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><C:calendar-home-set/></D:prop>
</D:propfind>`;
    const { text } = await this.request(principalUrl, 'PROPFIND', username, password, body, { Depth: '0' });
    const href = extractOne(text, 'href');
    if (!href) throw new Error('Apple CalDAV: could not discover the calendar home.');
    return href.startsWith('http') ? href : `${CALDAV_BASE}${href}`;
  }

  // Step 3: list calendars in the home set and pick the first real one —
  // skips special collections (scheduling inbox/outbox, etc.) that report a
  // resourcetype without "calendar" in it. "Pick the first one" is a
  // deliberate v1 simplification — no calendar-picker UI yet, see README.
  async findDefaultCalendar(homeUrl: string, username: string, password: string): Promise<string> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:resourcetype/><D:displayname/></D:prop>
</D:propfind>`;
    const { text } = await this.request(homeUrl, 'PROPFIND', username, password, body, { Depth: '1' });
    const responses = extractAll(text, 'response');
    for (const response of responses) {
      const resourcetype = extractOne(response, 'resourcetype') ?? '';
      if (!/calendar/i.test(resourcetype)) continue;
      const href = extractOne(response, 'href');
      if (href) return href.startsWith('http') ? href : `${CALDAV_BASE}${href}`;
    }
    throw new Error('Apple CalDAV: no calendar found in this account.');
  }

  // Incremental sync via RFC 6578 sync-collection — the CalDAV equivalent
  // of Google's syncToken/Microsoft's deltaLink: an empty sync-token on the
  // first call returns every current event plus a token for next time; a
  // stored token on later calls returns only what changed since then.
  // Requests calendar-data (the raw ICS) inline so this is the only network
  // round trip per sync, same "avoid an n+1 fetch-list-then-fetch-each-item"
  // reasoning as Google/Microsoft's single-list-call sync.
  async listEvents(params: {
    username: string;
    password: string;
    calendarUrl: string;
    syncToken?: string;
  }): Promise<ListEventsResult> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:sync-collection xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:sync-token>${params.syncToken ?? ''}</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
</D:sync-collection>`;

    const { status, text } = await this.request(params.calendarUrl, 'REPORT', params.username, params.password, body);

    if (status === 507 || (status >= 400 && params.syncToken)) {
      // 507 Insufficient Storage is CalDAV's documented "this sync-token is
      // no longer valid" signal (RFC 6578 §3.6); a generic 4xx on a
      // token'd request is treated the same defensive way, since real
      // servers vary — same "drop the token, do one full resync" handling
      // as Google's 410 and Microsoft's 410.
      return { events: [], fullResyncRequired: true };
    }
    if (status >= 400) {
      throw new Error(`Apple CalDAV sync-collection failed: ${status} ${text}`);
    }

    const nextSyncToken = extractOne(text, 'sync-token');
    const responses = extractAll(text, 'response');
    const events: AppleCalendarEvent[] = responses.map((response) => {
      const href = extractOne(response, 'href') ?? '';
      const statusLine = extractOne(response, 'status') ?? '';
      if (/\s404\s/.test(` ${statusLine} `)) {
        return { href, removed: true };
      }
      const icsData = extractOne(response, 'calendar-data');
      return { href, removed: false, ...(icsData ? parseIcsFields(icsData) : {}) };
    });

    return { events, nextSyncToken, fullResyncRequired: false };
  }
}
