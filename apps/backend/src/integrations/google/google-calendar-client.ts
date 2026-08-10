import { Injectable } from '@nestjs/common';

export interface GoogleCalendarEvent {
  id: string;
  status: string; // 'confirmed' | 'cancelled' | ...
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export interface ListEventsResult {
  events: GoogleCalendarEvent[];
  nextSyncToken?: string;
  fullResyncRequired: boolean;
}

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// The three outcomes deleteEvent needs its caller to tell apart: a normal
// success, "it was already gone" (Google returns 404/410 for an event
// that's already deleted — idempotent, not an error), and "we're not
// allowed to do this" (401/403 — expired token or, more importantly here,
// a token that was only ever granted the old readonly scope). The caller
// (GoogleCalendarWriteService) needs that last case specifically to decide
// whether retrying makes sense or the account needs a real reconnect.
export type DeleteEventOutcome = 'deleted' | 'already_gone';
export class GoogleAuthOrScopeError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'GoogleAuthOrScopeError';
  }
}

// Thin wrapper over the Calendar API v3 REST surface — events.list (initial
// time-bounded sync and subsequent syncToken-based incremental syncs), plus
// events.delete for the two-way sync increment's push-deletes-back feature.
@Injectable()
export class GoogleCalendarClient {
  async listEvents(params: {
    accessToken: string;
    syncToken?: string;
    timeMin?: string;
    timeMax?: string;
  }): Promise<ListEventsResult> {
    const events: GoogleCalendarEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;

    do {
      const query = new URLSearchParams({ singleEvents: 'true' });
      if (params.syncToken) {
        query.set('syncToken', params.syncToken);
      } else {
        if (params.timeMin) query.set('timeMin', params.timeMin);
        if (params.timeMax) query.set('timeMax', params.timeMax);
      }
      if (pageToken) query.set('pageToken', pageToken);

      const res = await fetch(`${CALENDAR_API_BASE}?${query.toString()}`, {
        headers: { Authorization: `Bearer ${params.accessToken}` },
      });

      if (res.status === 410) {
        // Google's documented signal that a syncToken is no longer valid —
        // the caller must drop it and do a fresh full sync.
        return { events: [], fullResyncRequired: true };
      }
      if (!res.ok) {
        throw new Error(`Google Calendar events.list failed: ${res.status} ${await res.text()}`);
      }

      const body = (await res.json()) as any;
      events.push(...(body.items ?? []));
      pageToken = body.nextPageToken;
      nextSyncToken = body.nextSyncToken ?? nextSyncToken;
    } while (pageToken);

    return { events, nextSyncToken, fullResyncRequired: false };
  }

  async deleteEvent(params: { accessToken: string; externalEventId: string }): Promise<DeleteEventOutcome> {
    const res = await fetch(`${CALENDAR_API_BASE}/${encodeURIComponent(params.externalEventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });

    if (res.ok || res.status === 404 || res.status === 410) {
      // 200/204 = deleted; 404/410 = already gone on Google's side (someone
      // deleted it there first, or a previous attempt actually succeeded but
      // the response never made it back) — either way, the end state this
      // caller wants is achieved, so this isn't a failure.
      return res.status === 404 || res.status === 410 ? 'already_gone' : 'deleted';
    }

    if (res.status === 401 || res.status === 403) {
      throw new GoogleAuthOrScopeError(res.status, await res.text());
    }

    throw new Error(`Google Calendar events.delete failed: ${res.status} ${await res.text()}`);
  }

  // Push-edits-back increment: a PATCH, not a full PUT — only the fields
  // actually present get sent, so an edit that only changes the title never
  // risks clobbering a description or time this app doesn't even know about
  // yet (a synced event's own `description` isn't currently pulled down
  // into `CalendarEvent` at all — see the sync writer in
  // calendar.service.ts — so this app should never overwrite one it never
  // read in the first place).
  async updateEvent(params: {
    accessToken: string;
    externalEventId: string;
    summary?: string;
    description?: string;
    startTime?: Date;
    endTime?: Date;
  }): Promise<void> {
    const body: Record<string, unknown> = {};
    if (params.summary !== undefined) body.summary = params.summary;
    if (params.description !== undefined) body.description = params.description;
    if (params.startTime) body.start = { dateTime: params.startTime.toISOString() };
    if (params.endTime) body.end = { dateTime: params.endTime.toISOString() };

    const res = await fetch(`${CALENDAR_API_BASE}/${encodeURIComponent(params.externalEventId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) return;
    if (res.status === 404 || res.status === 410) {
      // Already gone on Google's side — same idempotent treatment as
      // deleteEvent: there's nothing left to patch, and the end state a
      // caller wants (this event no longer diverges locally vs. remotely
      // in a way this app can fix) is as close to achieved as it can be.
      return;
    }
    if (res.status === 401 || res.status === 403) {
      throw new GoogleAuthOrScopeError(res.status, await res.text());
    }

    throw new Error(`Google Calendar events.patch failed: ${res.status} ${await res.text()}`);
  }

  // Real-time calendar updates (webhooks) increment. Google's push-
  // notification setup: subscribe ("watch") this account's primary calendar
  // for changes, and Google will POST a near-empty notification (no event
  // data — just headers identifying the channel) to `address` every time
  // something changes, which the caller then treats as "go run a normal
  // syncToken-based sync" (see CalendarAccountsService.syncByChannel). This
  // is the exact same events endpoint listEvents/deleteEvent/updateEvent
  // already use, just its own `/watch` action rather than list/delete/patch.
  async watchEvents(params: {
    accessToken: string;
    channelId: string;
    address: string;
    token: string;
  }): Promise<{ resourceId: string; expiration?: string }> {
    const res = await fetch(`${CALENDAR_API_BASE}/watch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: params.channelId,
        type: 'web_hook',
        address: params.address,
        token: params.token,
      }),
    });

    if (!res.ok) {
      throw new Error(`Google Calendar events.watch failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as any;
    return { resourceId: body.resourceId, expiration: body.expiration };
  }

  // Stops a previously-registered channel — called from unregisterWebhook
  // (best-effort, on disconnect) so Google stops POSTing to an address this
  // app no longer cares about, and from renewWebhookIfNeeded (stop the old
  // channel once the new one is confirmed). A 404 here means the channel
  // already doesn't exist on Google's side (e.g. it already expired
  // naturally) — same idempotent "already gone" treatment deleteEvent gives
  // its own 404/410, not a real failure.
  async stopChannel(params: { accessToken: string; channelId: string; resourceId: string }): Promise<void> {
    const res = await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: params.channelId, resourceId: params.resourceId }),
    });

    if (!res.ok && res.status !== 404) {
      throw new Error(`Google Calendar channels.stop failed: ${res.status} ${await res.text()}`);
    }
  }
}
