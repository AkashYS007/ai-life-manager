import { Injectable } from '@nestjs/common';

export interface MicrosoftCalendarEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  isCancelled?: boolean;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  // Present (as `{ reason: 'deleted' }`) instead of the event's normal
  // fields when a delta response is reporting a removal — Microsoft Graph's
  // equivalent of Google's `status: 'cancelled'`.
  '@removed'?: { reason: string };
}

export interface ListEventsResult {
  events: MicrosoftCalendarEvent[];
  nextDeltaLink?: string;
  fullResyncRequired: boolean;
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Same three outcomes as GoogleCalendarClient.deleteEvent, for the same
// reason — see that file's comment. Graph's status codes for these cases
// line up with Google's (200/204 success, 404/410 already-gone, 401/403
// auth-or-scope), so the shape here is deliberately identical.
export type DeleteEventOutcome = 'deleted' | 'already_gone';
export class MicrosoftAuthOrScopeError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'MicrosoftAuthOrScopeError';
  }
}

// Thin wrapper over the Microsoft Graph calendar delta query — the
// Graph equivalent of Google's syncToken-based events.list: the first call
// establishes a time window, every later call replays the exact URL Graph
// handed back (`@odata.deltaLink`) to get only what changed since then. Kept
// deliberately parallel to GoogleCalendarClient in shape even though the
// underlying request mechanics (a full replay URL vs. a token you attach
// yourself) differ.
@Injectable()
export class MicrosoftCalendarClient {
  async listEvents(params: { accessToken: string; deltaLink?: string; timeMin?: string; timeMax?: string }): Promise<ListEventsResult> {
    const events: MicrosoftCalendarEvent[] = [];
    // The delta link is a complete, ready-to-fetch URL Graph gave us on a
    // previous call — nothing to build. Only the very first sync (or a
    // resync after a 410) needs to construct the initial calendarview/delta
    // request with an explicit time window.
    let nextUrl =
      params.deltaLink ??
      (() => {
        const query = new URLSearchParams({
          startDateTime: params.timeMin ?? '',
          endDateTime: params.timeMax ?? '',
        });
        return `${GRAPH_BASE}/me/calendarview/delta?${query.toString()}`;
      })();

    let nextDeltaLink: string | undefined;

    do {
      const res = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${params.accessToken}` },
      });

      if (res.status === 410) {
        // Graph's documented signal that a delta link is no longer valid
        // (e.g. too old) — same handling as Google's 410: drop it, the
        // caller does one full resync.
        return { events: [], fullResyncRequired: true };
      }
      if (!res.ok) {
        throw new Error(`Microsoft Graph calendarview/delta failed: ${res.status} ${await res.text()}`);
      }

      const body = (await res.json()) as any;
      events.push(...(body.value ?? []));
      nextUrl = body['@odata.nextLink'];
      nextDeltaLink = body['@odata.deltaLink'] ?? nextDeltaLink;
    } while (nextUrl);

    return { events, nextDeltaLink, fullResyncRequired: false };
  }

  async deleteEvent(params: { accessToken: string; externalEventId: string }): Promise<DeleteEventOutcome> {
    const res = await fetch(`${GRAPH_BASE}/me/events/${encodeURIComponent(params.externalEventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });

    if (res.ok || res.status === 404 || res.status === 410) {
      // 204 = deleted; 404/410 = already gone on Microsoft's side — same
      // idempotent treatment as GoogleCalendarClient.deleteEvent.
      return res.status === 404 || res.status === 410 ? 'already_gone' : 'deleted';
    }

    if (res.status === 401 || res.status === 403) {
      throw new MicrosoftAuthOrScopeError(res.status, await res.text());
    }

    throw new Error(`Microsoft Graph events.delete failed: ${res.status} ${await res.text()}`);
  }

  // Push-edits-back increment, mirroring GoogleCalendarClient.updateEvent's
  // own reasoning exactly: a PATCH with only the changed fields, treating
  // 404/410 as an idempotent no-op rather than a failure. `timeZone: 'UTC'`
  // alongside each `dateTime` is required by Graph's own event schema (a
  // bare ISO string with a trailing `Z` isn't enough on its own) — matches
  // `toISOString()`'s own UTC output, so the two stay consistent with each
  // other.
  async updateEvent(params: {
    accessToken: string;
    externalEventId: string;
    subject?: string;
    description?: string;
    startTime?: Date;
    endTime?: Date;
  }): Promise<void> {
    const body: Record<string, unknown> = {};
    if (params.subject !== undefined) body.subject = params.subject;
    if (params.description !== undefined) body.body = { contentType: 'text', content: params.description };
    if (params.startTime) body.start = { dateTime: params.startTime.toISOString(), timeZone: 'UTC' };
    if (params.endTime) body.end = { dateTime: params.endTime.toISOString(), timeZone: 'UTC' };

    const res = await fetch(`${GRAPH_BASE}/me/events/${encodeURIComponent(params.externalEventId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) return;
    if (res.status === 404 || res.status === 410) return;
    if (res.status === 401 || res.status === 403) {
      throw new MicrosoftAuthOrScopeError(res.status, await res.text());
    }

    throw new Error(`Microsoft Graph events.patch failed: ${res.status} ${await res.text()}`);
  }

  // Real-time calendar updates (webhooks) increment. Graph's push-
  // notification setup: a `subscription` resource, not a "watch" verb the
  // way Google models it, but the same underlying idea — Graph POSTs a
  // notification (subscription id + a bit of resource metadata, still no
  // full event body) to `notificationUrl` whenever `/me/events` changes,
  // which the caller then treats as "go run a normal delta-link sync" (see
  // MicrosoftCalendarAccountsService.syncBySubscription). `clientState` is
  // an app-generated secret Graph echoes back unchanged on every
  // notification — this app's own way of verifying a notification is
  // genuinely about this subscription, the Graph equivalent of Google's
  // channel `token`. `expirationDateTime` is capped by Graph itself (~4230
  // minutes, about 3 days, for `/me/events` — far shorter than Google's
  // calendar channels) and is Graph's own responsibility to enforce; this
  // app just requests as long a window as it's allowed and renews well
  // before it (see renewWebhookIfNeeded).
  async createSubscription(params: {
    accessToken: string;
    notificationUrl: string;
    clientState: string;
    expirationDateTime: string;
  }): Promise<{ subscriptionId: string; expirationDateTime: string }> {
    const res = await fetch(`${GRAPH_BASE}/subscriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changeType: 'created,updated,deleted',
        notificationUrl: params.notificationUrl,
        resource: '/me/events',
        expirationDateTime: params.expirationDateTime,
        clientState: params.clientState,
      }),
    });

    if (!res.ok) {
      throw new Error(`Microsoft Graph subscriptions.create failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as any;
    return { subscriptionId: body.id, expirationDateTime: body.expirationDateTime };
  }

  // Extends an existing subscription's expiration in place (a PATCH, not a
  // delete-and-recreate) — Graph's own documented renewal path, and the
  // simpler option here since it means the subscription id this app already
  // stored (`webhookChannelId`) stays valid and doesn't need updating.
  async renewSubscription(params: {
    accessToken: string;
    subscriptionId: string;
    expirationDateTime: string;
  }): Promise<{ expirationDateTime: string }> {
    const res = await fetch(`${GRAPH_BASE}/subscriptions/${encodeURIComponent(params.subscriptionId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${params.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expirationDateTime: params.expirationDateTime }),
    });

    if (!res.ok) {
      throw new Error(`Microsoft Graph subscriptions.renew failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as any;
    return { expirationDateTime: body.expirationDateTime };
  }

  // Called from unregisterWebhook (best-effort, on disconnect). A 404 here
  // means the subscription is already gone on Graph's side (most likely it
  // already expired without ever being renewed) — same idempotent
  // "already gone" treatment deleteEvent gives its own 404/410, not a real
  // failure.
  async deleteSubscription(params: { accessToken: string; subscriptionId: string }): Promise<void> {
    const res = await fetch(`${GRAPH_BASE}/subscriptions/${encodeURIComponent(params.subscriptionId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });

    if (!res.ok && res.status !== 404) {
      throw new Error(`Microsoft Graph subscriptions.delete failed: ${res.status} ${await res.text()}`);
    }
  }
}
