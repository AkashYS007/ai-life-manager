import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';
import { AppleCaldavClient, AppleAuthError } from './apple-caldav-client';
import { parseIcsDate } from './ics-parser';
import { encryptToken, decryptToken } from '../crypto/token-cipher';

// Thrown when Apple rejects the Apple ID / app-specific password pair
// during connect() — mapped to a specific error code by the resolver (same
// "distinct, expected failure gets its own type" reasoning as
// GoogleReconnectRequiredError/FocusSessionAlreadyActiveError) so the
// frontend can show "check your Apple ID and app-specific password" rather
// than a generic "couldn't connect."
export class AppleAuthFailedError extends Error {
  constructor() {
    super('Apple could not verify that Apple ID and app-specific password. Double check both and try again.');
    this.name = 'AppleAuthFailedError';
  }
}

// Mirrors calendar-accounts.service.ts (Google) and
// microsoft-calendar-accounts.service.ts's lifecycle-owning pattern:
// connect (here: verify credentials + discover the calendar + initial
// sync), sync (incremental, via CalDAV's sync-collection token), disconnect.
// Kept as its own class rather than generalizing all three providers into
// one service, same reasoning as Microsoft's — enough of the actual
// mechanics differ (Basic Auth vs. OAuth, XML vs. JSON, a discovery chain
// vs. a fixed API base) that a shared abstraction would mostly be
// conditionals.
@Injectable()
export class AppleCalendarAccountsService {
  private readonly logger = new Logger(AppleCalendarAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly calendarService: CalendarService,
    private readonly caldavClient: AppleCaldavClient,
  ) {}

  private get encryptionKey(): string {
    return this.config.get<string>('TOKEN_ENCRYPTION_KEY')!;
  }

  async getForUser(userId: string) {
    return this.prisma.calendarAccount.findUnique({
      where: { userId_provider: { userId, provider: 'APPLE' } },
    });
  }

  // Unlike Google/Microsoft's OAuth redirect, this is a direct
  // username+password form submission — CalDAV has no OAuth consent screen
  // (see README) — so the whole connect flow is one synchronous GraphQL
  // mutation, no callback controller or redirect needed.
  async connect(userId: string, appleId: string, appSpecificPassword: string) {
    let calendarUrl: string;
    try {
      const principalUrl = await this.caldavClient.discoverPrincipal(appleId, appSpecificPassword);
      const homeUrl = await this.caldavClient.discoverCalendarHome(principalUrl, appleId, appSpecificPassword);
      calendarUrl = await this.caldavClient.findDefaultCalendar(homeUrl, appleId, appSpecificPassword);
    } catch (error) {
      if (error instanceof AppleAuthError) {
        throw new AppleAuthFailedError();
      }
      throw error;
    }

    const encryptedPassword = encryptToken(appSpecificPassword, this.encryptionKey);
    const account = await this.prisma.calendarAccount.upsert({
      where: { userId_provider: { userId, provider: 'APPLE' } },
      create: {
        userId,
        provider: 'APPLE',
        externalAccountEmail: appleId,
        // No separate refresh secret exists for CalDAV Basic Auth (unlike
        // OAuth's access/refresh token pair) — the same encrypted
        // app-specific password is stored in both columns purely to
        // satisfy the schema's shared NOT NULL shape across all three
        // providers, not because there are genuinely two different secrets.
        accessTokenEncrypted: encryptedPassword,
        refreshTokenEncrypted: encryptedPassword,
        calendarUrl,
        status: 'ACTIVE',
      },
      update: {
        externalAccountEmail: appleId,
        accessTokenEncrypted: encryptedPassword,
        refreshTokenEncrypted: encryptedPassword,
        calendarUrl,
        status: 'ACTIVE',
        syncToken: null, // reconnecting starts sync history over, same as Google/Microsoft
      },
    });

    // Phantom-connected-account fix (2026-08-24, backend audit Update 49
    // finding #8, medium severity) — same fix, same reasoning, as
    // CalendarAccountsService's own connect() on the Google side: the row
    // above is upserted ACTIVE with valid tokens before this first sync
    // ever runs. Unlike Google/Microsoft this mutation has no redirect —
    // the resolver just surfaces `CONNECT_FAILED` straight to the caller —
    // but the same gap applies: the ACTIVE row was already committed, so
    // it read as connected server-side even while the person was told it
    // failed. Marks ERROR (not a delete — the app-specific password is
    // still good, only the sync failed) and re-throws so the resolver's
    // existing `CONNECT_FAILED` handling is unchanged.
    try {
      await this.sync(account.id);
    } catch (error) {
      await this.prisma.calendarAccount.update({ where: { id: account.id }, data: { status: 'ERROR' } });
      throw error;
    }
    return account;
  }

  async disconnect(userId: string): Promise<boolean> {
    const account = await this.getForUser(userId);
    if (!account) return false;
    await this.prisma.calendarAccount.delete({ where: { id: account.id } });
    return true;
  }

  async syncNow(userId: string) {
    const account = await this.getForUser(userId);
    if (!account) {
      throw new Error('No connected Apple account for this user');
    }
    return this.sync(account.id);
  }

  private async sync(accountId: string): Promise<{ syncedCount: number; deletedCount: number }> {
    const account = await this.prisma.calendarAccount.findUniqueOrThrow({ where: { id: accountId } });
    const password = decryptToken(account.accessTokenEncrypted, this.encryptionKey);
    const username = account.externalAccountEmail!;
    if (!account.calendarUrl) {
      throw new Error('This Apple Calendar connection is missing its calendar URL — reconnect it.');
    }

    let result = await this.caldavClient.listEvents({
      username,
      password,
      calendarUrl: account.calendarUrl,
      syncToken: account.syncToken ?? undefined,
    });

    if (result.fullResyncRequired) {
      result = await this.caldavClient.listEvents({ username, password, calendarUrl: account.calendarUrl });
    }

    // Needed to interpret any DTSTART/DTEND that lacks a UTC 'Z' suffix
    // (see ics-parser.ts's parseIcsDate) — the owning user's own configured
    // app timezone, not the server's.
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: account.userId } });

    let syncedCount = 0;
    let deletedCount = 0;
    for (const event of result.events) {
      if (event.removed || event.status === 'CANCELLED') {
        await this.calendarService.deleteByExternalId(accountId, event.href);
        deletedCount += 1;
        continue;
      }
      if (!event.dtstart || !event.dtend) continue; // skip malformed entries rather than crash the whole sync

      const start = parseIcsDate(event.dtstart, user.timezone);
      const end = parseIcsDate(event.dtend, user.timezone);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

      await this.calendarService.upsertFromExternalSource({
        userId: account.userId,
        calendarAccountId: accountId,
        externalEventId: event.href,
        title: event.summary ?? '(No title)',
        startTime: start,
        endTime: end,
        source: 'APPLE',
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
