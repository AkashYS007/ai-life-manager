import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalendarAccount } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleCalendarClient } from './google-calendar-client';
import { encryptToken, decryptToken } from '../crypto/token-cipher';

// Real-time calendar updates (webhooks) increment. Google doesn't strictly
// document a hard maximum for Calendar API channel expiration the way Drive
// does (24h) — this app requests 7 days on every (re)registration, a
// deliberately conservative, well-inside-any-undocumented-limit window, and
// simply uses whatever Google actually grants back (`watchEvents`'s own
// `expiration` field) rather than assuming this request is always honored
// exactly. Renewed by SchedulerService.renewCalendarWebhooks well before
// that, whatever it turns out to be.
const GOOGLE_WEBHOOK_REQUESTED_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

// One place owning the full lifecycle of a connected Google account:
// connect (first-time OAuth exchange + initial sync), sync (incremental,
// using Google's syncToken), disconnect. GraphQL resolvers call this, not
// GoogleOAuthService/GoogleCalendarClient directly.
@Injectable()
export class CalendarAccountsService {
  private readonly logger = new Logger(CalendarAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly calendarService: CalendarService,
    private readonly googleOAuth: GoogleOAuthService,
    private readonly googleCalendarClient: GoogleCalendarClient,
  ) {}

  private get encryptionKey(): string {
    return this.config.get<string>('TOKEN_ENCRYPTION_KEY')!;
  }

  async getForUser(userId: string) {
    return this.prisma.calendarAccount.findUnique({
      where: { userId_provider: { userId, provider: 'GOOGLE' } },
    });
  }

  // Runs the full OAuth code exchange plus the first sync. Google's
  // `access_type=offline` + `prompt=consent` (google-oauth.service.ts)
  // guarantee a refresh_token here; without one, a re-connect after a
  // revoke would silently only get an access token that expires in an
  // hour with no way to renew it.
  async connect(userId: string, code: string) {
    const tokens = await this.googleOAuth.exchangeCodeForTokens(code);
    if (!tokens.refreshToken) {
      throw new Error(
        'Google did not return a refresh token. Revoke this app\'s access at myaccount.google.com/permissions and try connecting again.',
      );
    }
    const email = await this.googleOAuth.fetchAccountEmail(tokens.accessToken);

    const account = await this.prisma.calendarAccount.upsert({
      where: { userId_provider: { userId, provider: 'GOOGLE' } },
      create: {
        userId,
        provider: 'GOOGLE',
        externalAccountEmail: email,
        accessTokenEncrypted: encryptToken(tokens.accessToken, this.encryptionKey),
        refreshTokenEncrypted: encryptToken(tokens.refreshToken, this.encryptionKey),
        status: 'ACTIVE',
      },
      update: {
        externalAccountEmail: email,
        accessTokenEncrypted: encryptToken(tokens.accessToken, this.encryptionKey),
        refreshTokenEncrypted: encryptToken(tokens.refreshToken, this.encryptionKey),
        status: 'ACTIVE',
        syncToken: null, // reconnecting means starting sync history over
      },
    });

    // Phantom-connected-account fix (2026-08-24, backend audit Update 49
    // finding #8, medium severity): the row above is upserted as ACTIVE
    // with valid tokens *before* this first sync ever runs. If Google
    // returns a transient error (a 5xx, a timeout) on this very first API
    // call, the exception used to propagate straight out of connect() —
    // the OAuth callback controller catches it and redirects the user to
    // an error page, but this row was already committed and left sitting
    // there as ACTIVE, so the account silently shows up as "connected"
    // server-side even though the person was told it failed. The tokens
    // themselves are still good here (the failure is in fetching *events*,
    // not in the OAuth exchange) — deleting the row would force a full
    // re-consent for no reason — so this marks it ERROR instead, an
    // accurate reflection of "connected, but the initial sync hasn't
    // actually succeeded yet," then re-throws so the existing
    // caller-facing error handling (the OAuth controller's redirect) is
    // completely unchanged.
    try {
      await this.sync(account.id);
    } catch (error) {
      await this.prisma.calendarAccount.update({ where: { id: account.id }, data: { status: 'ERROR' } });
      throw error;
    }
    // Best-effort, same "an enhancement must never block the core action"
    // principle as every other automatic-write-after-a-real-action in this
    // app (see e.g. MemoryService.refreshChronotypePattern's own callers) —
    // a failed or skipped webhook registration just means this account
    // stays on manual "Sync now" only, exactly as it would have before this
    // increment existed.
    try {
      await this.registerWebhook(account.id);
    } catch (error) {
      this.logger.warn(`Google Calendar webhook registration failed for account ${account.id}: ${(error as Error).message}`);
    }
    return account;
  }

  async disconnect(userId: string): Promise<boolean> {
    const account = await this.getForUser(userId);
    if (!account) return false;
    // Best-effort — if this fails, the channel simply expires naturally on
    // Google's side later (GOOGLE_WEBHOOK_REQUESTED_LIFETIME_MS at most) and
    // POSTs to an address whose account no longer exists here; the webhook
    // controller's own account lookup below just finds nothing and no-ops,
    // so this is a harmless (if slightly wasteful) failure mode, not a
    // reason to block the actual disconnect the person asked for.
    if (account.webhookChannelId && account.webhookResourceId) {
      try {
        await this.unregisterWebhook(account);
      } catch (error) {
        this.logger.warn(`Google Calendar webhook unregistration failed for account ${account.id}: ${(error as Error).message}`);
      }
    }
    // onDelete: Cascade (schema.prisma) removes every event that came from
    // this account along with it — see the schema comment for why that's
    // the honest behavior rather than leaving orphaned foreign events.
    await this.prisma.calendarAccount.delete({ where: { id: account.id } });
    return true;
  }

  // Real-time calendar updates (webhooks) increment. Subscribes this
  // account's primary calendar to Google's push notifications — called
  // best-effort right after connect()'s own initial sync, and again by
  // SchedulerService.renewCalendarWebhooks (via renewWebhookIfNeeded) before
  // the previously-granted channel expires. Silently does nothing (not an
  // error) when BACKEND_PUBLIC_URL isn't configured — see that env var's own
  // comment for why this is the one deliberately silent no-op in this
  // pipeline rather than a logged warning: an operator who never set it
  // hasn't done anything wrong, they just haven't opted into a feature that
  // needs a real public HTTPS address to work at all.
  async registerWebhook(accountId: string): Promise<void> {
    const baseUrl = this.config.get<string>('BACKEND_PUBLIC_URL');
    if (!baseUrl) return;

    const account = await this.prisma.calendarAccount.findUniqueOrThrow({ where: { id: accountId } });
    let accessToken = decryptToken(account.accessTokenEncrypted, this.encryptionKey);

    const channelId = randomUUID();
    const verificationToken = randomUUID();
    const address = `${baseUrl.replace(/\/$/, '')}/webhooks/google/calendar`;

    let watch;
    try {
      watch = await this.googleCalendarClient.watchEvents({ accessToken, channelId, address, token: verificationToken });
    } catch (error) {
      // Same "access tokens expire hourly, refresh once and retry" handling
      // as sync() above — a webhook registration triggered by the renewal
      // cron (rather than right after a fresh connect()) is exactly the
      // case most likely to be working with a stale access token.
      this.logger.warn(`Google Calendar events.watch failed, attempting token refresh: ${(error as Error).message}`);
      const refreshToken = decryptToken(account.refreshTokenEncrypted, this.encryptionKey);
      const refreshed = await this.googleOAuth.refreshAccessToken(refreshToken);
      accessToken = refreshed.accessToken;
      await this.prisma.calendarAccount.update({
        where: { id: accountId },
        data: { accessTokenEncrypted: encryptToken(accessToken, this.encryptionKey) },
      });
      watch = await this.googleCalendarClient.watchEvents({ accessToken, channelId, address, token: verificationToken });
    }

    await this.prisma.calendarAccount.update({
      where: { id: accountId },
      data: {
        webhookChannelId: channelId,
        webhookResourceId: watch.resourceId,
        webhookVerificationToken: verificationToken,
        webhookExpiresAt: watch.expiration
          ? new Date(Number(watch.expiration))
          : new Date(Date.now() + GOOGLE_WEBHOOK_REQUESTED_LIFETIME_MS),
      },
    });
  }

  private async unregisterWebhook(account: CalendarAccount): Promise<void> {
    if (!account.webhookChannelId || !account.webhookResourceId) return;
    const accessToken = decryptToken(account.accessTokenEncrypted, this.encryptionKey);
    await this.googleCalendarClient.stopChannel({
      accessToken,
      channelId: account.webhookChannelId,
      resourceId: account.webhookResourceId,
    });
  }

  // Called from SchedulerService's own renewal sweep — stops the
  // soon-to-expire channel (best-effort; if this fails the old channel just
  // expires naturally, no harm) and registers a brand new one, since Google
  // has no "extend this channel's expiration in place" endpoint the way
  // Microsoft Graph's subscriptions.patch does (see the Microsoft side of
  // this same increment for that contrast).
  async renewWebhookIfNeeded(accountId: string): Promise<void> {
    const account = await this.prisma.calendarAccount.findUniqueOrThrow({ where: { id: accountId } });
    if (account.webhookChannelId && account.webhookResourceId) {
      try {
        await this.unregisterWebhook(account);
      } catch (error) {
        this.logger.warn(`Google Calendar old-channel stop failed during renewal for account ${accountId}: ${(error as Error).message}`);
      }
    }
    await this.registerWebhook(accountId);
  }

  // Real-time calendar updates (webhooks) increment — the actual reaction
  // to an incoming Google notification (see GoogleCalendarWebhookController).
  // Google's notification carries no event data at all, just headers
  // identifying which channel/resource changed, so "something changed" is
  // always resolved the same honest way this app already has: run a normal
  // incremental sync and let Google's syncToken mechanism report the real
  // diff. `resourceId`/`token` are checked against what's actually stored
  // for the channel this notification claims to be for — a request with the
  // right `channelId` but a wrong resourceId/token is treated as untrusted
  // and silently ignored, the same "verify before acting" discipline
  // `verifyState`/`peekReturnTo` already apply to the OAuth callbacks.
  async syncByChannel(channelId: string, resourceId: string, token: string): Promise<void> {
    const account = await this.prisma.calendarAccount.findFirst({ where: { webhookChannelId: channelId } });
    if (!account || account.webhookResourceId !== resourceId || account.webhookVerificationToken !== token) {
      this.logger.warn(`Google Calendar webhook notification failed verification for channel ${channelId}`);
      return;
    }
    await this.sync(account.id);
  }

  async syncNow(userId: string) {
    const account = await this.getForUser(userId);
    if (!account) {
      throw new Error('No connected Google account for this user');
    }
    return this.sync(account.id);
  }

  private async sync(accountId: string): Promise<{ syncedCount: number; deletedCount: number }> {
    const account = await this.prisma.calendarAccount.findUniqueOrThrow({ where: { id: accountId } });
    let accessToken = decryptToken(account.accessTokenEncrypted, this.encryptionKey);

    const runList = async (syncToken?: string) =>
      this.googleCalendarClient.listEvents({
        accessToken,
        syncToken,
        // First sync only: a 90-day-back to 180-day-forward window. Once we
        // have a syncToken, every later call is a true incremental diff and
        // no longer needs a time window at all (Google's API contract).
        ...(syncToken
          ? {}
          : {
              timeMin: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
              timeMax: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
            }),
      });

    let result;
    try {
      result = await runList(account.syncToken ?? undefined);
    } catch (error) {
      // Access tokens expire hourly — a 401 here almost always means an
      // expired token, so refresh once and retry rather than surfacing a
      // confusing failure to the user for the single most common case.
      this.logger.warn(`Google Calendar list failed, attempting token refresh: ${(error as Error).message}`);
      const refreshToken = decryptToken(account.refreshTokenEncrypted, this.encryptionKey);
      const refreshed = await this.googleOAuth.refreshAccessToken(refreshToken);
      accessToken = refreshed.accessToken;
      await this.prisma.calendarAccount.update({
        where: { id: accountId },
        data: { accessTokenEncrypted: encryptToken(accessToken, this.encryptionKey) },
      });
      result = await runList(account.syncToken ?? undefined);
    }

    // Google invalidated our syncToken (410 Gone) — drop it and do one full
    // resync in the same call rather than making the user retry manually.
    if (result.fullResyncRequired) {
      result = await runList(undefined);
    }

    let syncedCount = 0;
    let deletedCount = 0;
    for (const event of result.events) {
      if (event.status === 'cancelled') {
        await this.calendarService.deleteByExternalId(accountId, event.id);
        deletedCount += 1;
        continue;
      }
      const start = event.start?.dateTime ?? event.start?.date;
      const end = event.end?.dateTime ?? event.end?.date;
      if (!start || !end) continue; // skip malformed entries rather than crash the whole sync

      await this.calendarService.upsertFromExternalSource({
        userId: account.userId,
        calendarAccountId: accountId,
        externalEventId: event.id,
        title: event.summary ?? '(No title)',
        description: event.description,
        startTime: new Date(start),
        endTime: new Date(end),
        source: 'GOOGLE',
      });
      syncedCount += 1;
    }

    await this.prisma.calendarAccount.update({
      where: { id: accountId },
      data: {
        syncToken: result.nextSyncToken ?? account.syncToken,
        lastSyncedAt: new Date(),
        status: 'ACTIVE',
      },
    });

    return { syncedCount, deletedCount };
  }
}
