import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalendarAccount } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';
import { MicrosoftOAuthService } from './microsoft-oauth.service';
import { MicrosoftCalendarClient } from './microsoft-calendar-client';
import { encryptToken, decryptToken } from '../crypto/token-cipher';

// Real-time calendar updates (webhooks) increment. Graph caps `/me/events`
// subscriptions at 4230 minutes (~2.94 days) — this app requests exactly
// that documented maximum on every (re)registration/renewal, then relies on
// SchedulerService.renewCalendarWebhooks to extend it again well before it
// lapses. Deliberately in minutes (Graph's own unit) rather than converting
// through milliseconds like the Google side does, since Graph's limit is
// itself expressed in minutes in its documentation.
const MICROSOFT_WEBHOOK_MAX_LIFETIME_MINUTES = 4230;

// Mirrors calendar-accounts.service.ts's (Google's) lifecycle-owning
// pattern closely: connect (OAuth exchange + initial sync), sync
// (incremental, via Graph's delta link instead of Google's syncToken),
// disconnect. Kept as its own class rather than generalizing the two
// providers into one service, since enough of the actual sync mechanics
// differ (delta link vs. syncToken, `@removed`/isCancelled vs. `status`,
// UTC-naive datetime strings vs. real ISO timestamps, refresh-token
// rotation) that a shared abstraction would mostly be conditionals.
@Injectable()
export class MicrosoftCalendarAccountsService {
  private readonly logger = new Logger(MicrosoftCalendarAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly calendarService: CalendarService,
    private readonly microsoftOAuth: MicrosoftOAuthService,
    private readonly microsoftCalendarClient: MicrosoftCalendarClient,
  ) {}

  private get encryptionKey(): string {
    return this.config.get<string>('TOKEN_ENCRYPTION_KEY')!;
  }

  async getForUser(userId: string) {
    return this.prisma.calendarAccount.findUnique({
      where: { userId_provider: { userId, provider: 'MICROSOFT' } },
    });
  }

  async connect(userId: string, code: string) {
    const tokens = await this.microsoftOAuth.exchangeCodeForTokens(code);
    if (!tokens.refreshToken) {
      throw new Error(
        'Microsoft did not return a refresh token. Remove this app\'s access at account.live.com/consent/Manage (personal) or your organization\'s Azure AD app access page (work/school), and try connecting again.',
      );
    }
    const email = await this.microsoftOAuth.fetchAccountEmail(tokens.accessToken);

    const account = await this.prisma.calendarAccount.upsert({
      where: { userId_provider: { userId, provider: 'MICROSOFT' } },
      create: {
        userId,
        provider: 'MICROSOFT',
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
        syncToken: null, // reconnecting means starting sync history over (this column doubles as the delta-link cursor for Microsoft — see sync() below)
      },
    });

    // Phantom-connected-account fix (2026-08-24, backend audit Update 49
    // finding #8, medium severity) — same fix, same reasoning, as
    // CalendarAccountsService's own connect() on the Google side: the row
    // above is upserted ACTIVE with valid tokens before this first sync
    // ever runs, so a transient failure here used to leave a silently
    // "connected" ACTIVE row behind even though the OAuth callback
    // controller redirects the user to an error page. Marks ERROR (not a
    // delete — the tokens are still good, only the sync failed) and
    // re-throws so that existing redirect-to-error-page handling is
    // unchanged.
    try {
      await this.sync(account.id);
    } catch (error) {
      await this.prisma.calendarAccount.update({ where: { id: account.id }, data: { status: 'ERROR' } });
      throw error;
    }
    // Best-effort — same "an enhancement must never block the core action"
    // principle CalendarAccountsService's own connect() already documents
    // for the identical call on the Google side.
    try {
      await this.registerWebhook(account.id);
    } catch (error) {
      this.logger.warn(`Microsoft Calendar webhook registration failed for account ${account.id}: ${(error as Error).message}`);
    }
    return account;
  }

  async disconnect(userId: string): Promise<boolean> {
    const account = await this.getForUser(userId);
    if (!account) return false;
    // Best-effort — if this fails the subscription just expires naturally
    // on Graph's side later (at most MICROSOFT_WEBHOOK_MAX_LIFETIME_MINUTES)
    // and POSTs to an address whose account no longer exists here; the
    // webhook controller's own account lookup below just finds nothing and
    // no-ops, same harmless failure mode CalendarAccountsService's own
    // disconnect() documents for the identical Google-side case.
    if (account.webhookChannelId) {
      try {
        await this.unregisterWebhook(account);
      } catch (error) {
        this.logger.warn(`Microsoft Calendar webhook unregistration failed for account ${account.id}: ${(error as Error).message}`);
      }
    }
    await this.prisma.calendarAccount.delete({ where: { id: account.id } });
    return true;
  }

  // Real-time calendar updates (webhooks) increment. Subscribes this
  // account's `/me/events` to Graph's push notifications — same "called
  // best-effort right after connect()'s own initial sync, and again by the
  // renewal cron" shape as the Google side's own registerWebhook. Silently
  // does nothing when BACKEND_PUBLIC_URL isn't configured — see that env
  // var's own comment in env.validation.ts.
  //
  // Unlike Google, Microsoft Graph validates the notification URL
  // *synchronously*, as part of this very createSubscription call: Graph
  // sends a GET with a `validationToken` query param to `notificationUrl`
  // and requires a plain-text 200 echoing it back within 10 seconds before
  // the subscription is even created (see MicrosoftCalendarWebhookController's
  // own handling of that handshake) — so a `BACKEND_PUBLIC_URL` that isn't
  // genuinely publicly reachable fails loudly right here, inside the same
  // try/catch this method's caller already treats as best-effort.
  async registerWebhook(accountId: string): Promise<void> {
    const baseUrl = this.config.get<string>('BACKEND_PUBLIC_URL');
    if (!baseUrl) return;

    const account = await this.prisma.calendarAccount.findUniqueOrThrow({ where: { id: accountId } });
    let accessToken = decryptToken(account.accessTokenEncrypted, this.encryptionKey);

    const clientState = randomUUID();
    const notificationUrl = `${baseUrl.replace(/\/$/, '')}/webhooks/microsoft/calendar`;
    const expirationDateTime = new Date(Date.now() + MICROSOFT_WEBHOOK_MAX_LIFETIME_MINUTES * 60 * 1000).toISOString();

    let subscription;
    try {
      subscription = await this.microsoftCalendarClient.createSubscription({
        accessToken,
        notificationUrl,
        clientState,
        expirationDateTime,
      });
    } catch (error) {
      // Same "access tokens expire hourly, refresh once and retry" handling
      // as sync() above.
      this.logger.warn(`Microsoft Graph subscriptions.create failed, attempting token refresh: ${(error as Error).message}`);
      const refreshToken = decryptToken(account.refreshTokenEncrypted, this.encryptionKey);
      const refreshed = await this.microsoftOAuth.refreshAccessToken(refreshToken);
      accessToken = refreshed.accessToken;
      await this.prisma.calendarAccount.update({
        where: { id: accountId },
        data: {
          accessTokenEncrypted: encryptToken(accessToken, this.encryptionKey),
          ...(refreshed.refreshToken
            ? { refreshTokenEncrypted: encryptToken(refreshed.refreshToken, this.encryptionKey) }
            : {}),
        },
      });
      subscription = await this.microsoftCalendarClient.createSubscription({
        accessToken,
        notificationUrl,
        clientState,
        expirationDateTime,
      });
    }

    await this.prisma.calendarAccount.update({
      where: { id: accountId },
      data: {
        webhookChannelId: subscription.subscriptionId,
        webhookVerificationToken: clientState,
        webhookExpiresAt: new Date(subscription.expirationDateTime),
      },
    });
  }

  private async unregisterWebhook(account: CalendarAccount): Promise<void> {
    if (!account.webhookChannelId) return;
    const accessToken = decryptToken(account.accessTokenEncrypted, this.encryptionKey);
    await this.microsoftCalendarClient.deleteSubscription({ accessToken, subscriptionId: account.webhookChannelId });
  }

  // Called from SchedulerService's own renewal sweep. Unlike Google, Graph
  // does support extending an existing subscription's expiration in place
  // (subscriptions.patch, no revalidation of notificationUrl needed) — used
  // here instead of delete-and-recreate, so the stored `webhookChannelId`
  // stays the exact same subscription id throughout an account's whole
  // connected lifetime.
  async renewWebhookIfNeeded(accountId: string): Promise<void> {
    const account = await this.prisma.calendarAccount.findUniqueOrThrow({ where: { id: accountId } });
    if (!account.webhookChannelId) {
      // No subscription to renew — most likely BACKEND_PUBLIC_URL wasn't
      // configured yet when this account first connected, or registration
      // failed at the time. Try a fresh registration instead of giving up.
      await this.registerWebhook(accountId);
      return;
    }

    const accessToken = decryptToken(account.accessTokenEncrypted, this.encryptionKey);
    const expirationDateTime = new Date(Date.now() + MICROSOFT_WEBHOOK_MAX_LIFETIME_MINUTES * 60 * 1000).toISOString();
    const renewed = await this.microsoftCalendarClient.renewSubscription({
      accessToken,
      subscriptionId: account.webhookChannelId,
      expirationDateTime,
    });
    await this.prisma.calendarAccount.update({
      where: { id: accountId },
      data: { webhookExpiresAt: new Date(renewed.expirationDateTime) },
    });
  }

  // Real-time calendar updates (webhooks) increment — the actual reaction
  // to an incoming Graph notification (see MicrosoftCalendarWebhookController).
  // Same "no real event data in the notification itself, just run a normal
  // sync" reasoning as the Google side's own syncByChannel; `clientState` is
  // checked against what's actually stored for the subscription this
  // notification claims to be for, the Graph equivalent of Google's
  // channel/resource-id pair.
  async syncBySubscription(subscriptionId: string, clientState: string): Promise<void> {
    const account = await this.prisma.calendarAccount.findFirst({ where: { webhookChannelId: subscriptionId } });
    if (!account || account.webhookVerificationToken !== clientState) {
      this.logger.warn(`Microsoft Calendar webhook notification failed verification for subscription ${subscriptionId}`);
      return;
    }
    await this.sync(account.id);
  }

  async syncNow(userId: string) {
    const account = await this.getForUser(userId);
    if (!account) {
      throw new Error('No connected Microsoft account for this user');
    }
    return this.sync(account.id);
  }

  private async sync(accountId: string): Promise<{ syncedCount: number; deletedCount: number }> {
    const account = await this.prisma.calendarAccount.findUniqueOrThrow({ where: { id: accountId } });
    let accessToken = decryptToken(account.accessTokenEncrypted, this.encryptionKey);

    // The `syncToken` column is generic storage shared across providers —
    // for Microsoft it holds the full `@odata.deltaLink` URL Graph gave us
    // last time, not a bare token, but the column's job (remember where the
    // last sync left off) is identical either way.
    const runList = async (deltaLink?: string) =>
      this.microsoftCalendarClient.listEvents({
        accessToken,
        deltaLink,
        ...(deltaLink
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
      // Access tokens expire hourly, same as Google's — refresh once and
      // retry rather than surfacing a confusing failure for the single most
      // common case.
      this.logger.warn(`Microsoft Graph list failed, attempting token refresh: ${(error as Error).message}`);
      const refreshToken = decryptToken(account.refreshTokenEncrypted, this.encryptionKey);
      const refreshed = await this.microsoftOAuth.refreshAccessToken(refreshToken);
      accessToken = refreshed.accessToken;
      // Unlike Google, Microsoft rotates the refresh token on every use — if
      // we don't persist the new one here, the *next* refresh will be
      // rejected as reusing an already-consumed token, silently breaking
      // sync days or weeks later. Only overwrite it if Microsoft actually
      // sent a new one (it always should, but don't null out a working
      // token if it somehow didn't).
      await this.prisma.calendarAccount.update({
        where: { id: accountId },
        data: {
          accessTokenEncrypted: encryptToken(accessToken, this.encryptionKey),
          ...(refreshed.refreshToken
            ? { refreshTokenEncrypted: encryptToken(refreshed.refreshToken, this.encryptionKey) }
            : {}),
        },
      });
      result = await runList(account.syncToken ?? undefined);
    }

    if (result.fullResyncRequired) {
      result = await runList(undefined);
    }

    let syncedCount = 0;
    let deletedCount = 0;
    for (const event of result.events) {
      if (event['@removed'] || event.isCancelled) {
        await this.calendarService.deleteByExternalId(accountId, event.id);
        deletedCount += 1;
        continue;
      }
      const startRaw = event.start?.dateTime;
      const endRaw = event.end?.dateTime;
      if (!startRaw || !endRaw) continue; // skip malformed entries rather than crash the whole sync

      // Graph returns these as UTC-naive strings (no trailing 'Z' or
      // offset) whenever no Prefer: outlook.timezone header is sent, which
      // this client never sends — appending 'Z' ourselves is what makes
      // `new Date(...)` parse it as UTC instead of silently treating it as
      // this server's own local time, which would shift every synced event
      // by however many hours the server's timezone happens to differ from
      // UTC.
      const start = new Date(`${startRaw}Z`);
      const end = new Date(`${endRaw}Z`);

      await this.calendarService.upsertFromExternalSource({
        userId: account.userId,
        calendarAccountId: accountId,
        externalEventId: event.id,
        title: event.subject ?? '(No title)',
        description: event.bodyPreview,
        startTime: start,
        endTime: end,
        source: 'MICROSOFT',
      });
      syncedCount += 1;
    }

    await this.prisma.calendarAccount.update({
      where: { id: accountId },
      data: {
        syncToken: result.nextDeltaLink ?? account.syncToken,
        lastSyncedAt: new Date(),
        status: 'ACTIVE',
      },
    });

    return { syncedCount, deletedCount };
  }
}
