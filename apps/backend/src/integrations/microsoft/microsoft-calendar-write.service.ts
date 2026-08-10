import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MicrosoftOAuthService } from './microsoft-oauth.service';
import { MicrosoftCalendarClient, MicrosoftAuthOrScopeError } from './microsoft-calendar-client';
import { encryptToken, decryptToken } from '../crypto/token-cipher';

// Mirrors GoogleReconnectRequiredError's reasoning exactly — thrown when a
// delete or (since the push-edits-back increment) an update fails because
// the connected account only has the old read-only scope (Calendars.Read,
// from before the original two-way-sync increment widened it to
// Calendars.ReadWrite) and hasn't been reconnected since. The resolver maps
// this to a distinct RECONNECT_REQUIRED error code, since retrying never
// fixes it — only a real reconnect (which forces a fresh consent screen via
// prompt=consent) does.
export class MicrosoftReconnectRequiredError extends Error {
  constructor() {
    super('This Microsoft Calendar connection only has read access. Reconnect it to allow editing or deleting synced events.');
    this.name = 'MicrosoftReconnectRequiredError';
  }
}

// Owns the write half of the Microsoft Calendar integration, structurally
// parallel to GoogleCalendarWriteService for the same reason it's a
// separate class from MicrosoftCalendarAccountsService: CalendarModule needs
// to depend on this directly without depending on all of IntegrationsModule
// (which already depends on CalendarModule), and this service's own
// dependencies (MicrosoftOAuthService, MicrosoftCalendarClient) have no
// dependency on CalendarModule, keeping the module graph one-directional.
@Injectable()
export class MicrosoftCalendarWriteService {
  private readonly logger = new Logger(MicrosoftCalendarWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly microsoftOAuth: MicrosoftOAuthService,
    private readonly microsoftCalendarClient: MicrosoftCalendarClient,
  ) {}

  private get encryptionKey(): string {
    return this.config.get<string>('TOKEN_ENCRYPTION_KEY')!;
  }

  // Deletes an event on the Microsoft side. Idempotent — an event already
  // gone on Microsoft's end is treated as success (see
  // MicrosoftCalendarClient.deleteEvent's 404/410 handling), not an error.
  async deleteRemoteEvent(calendarAccountId: string, externalEventId: string): Promise<void> {
    const account = await this.prisma.calendarAccount.findUniqueOrThrow({ where: { id: calendarAccountId } });
    let accessToken = decryptToken(account.accessTokenEncrypted, this.encryptionKey);

    try {
      await this.microsoftCalendarClient.deleteEvent({ accessToken, externalEventId });
      return;
    } catch (error) {
      if (!(error instanceof MicrosoftAuthOrScopeError)) throw error;

      // Same reasoning as GoogleCalendarWriteService: a 401 almost always
      // means an expired access token (refresh once, retry), a 403 more
      // often means a genuine missing-scope rejection — attempting the same
      // refresh+retry for both is cheap and gives the right outcome either
      // way, since a refreshed token still carries whatever scope was
      // originally consented to.
      this.logger.warn(
        `Microsoft Calendar delete failed (${error.status}), attempting token refresh: ${error.message}`,
      );

      let refreshedAccessToken: string;
      let rotatedRefreshToken: string | undefined;
      try {
        const refreshToken = decryptToken(account.refreshTokenEncrypted, this.encryptionKey);
        const refreshed = await this.microsoftOAuth.refreshAccessToken(refreshToken);
        refreshedAccessToken = refreshed.accessToken;
        rotatedRefreshToken = refreshed.refreshToken;
      } catch {
        // Refresh token itself is dead (revoked/expired) — no amount of
        // retrying fixes this, only a real reconnect does.
        throw new MicrosoftReconnectRequiredError();
      }

      accessToken = refreshedAccessToken;
      await this.prisma.calendarAccount.update({
        where: { id: calendarAccountId },
        data: {
          accessTokenEncrypted: encryptToken(accessToken, this.encryptionKey),
          // Unlike Google, Microsoft rotates the refresh token on every
          // use — skipping this write (like MicrosoftCalendarAccountsService.sync
          // already takes care to avoid) would silently break the *next*
          // refresh, days or weeks later, with "already used token" rather
          // than anything that points back at this code path.
          ...(rotatedRefreshToken ? { refreshTokenEncrypted: encryptToken(rotatedRefreshToken, this.encryptionKey) } : {}),
        },
      });

      try {
        await this.microsoftCalendarClient.deleteEvent({ accessToken, externalEventId });
      } catch (retryError) {
        if (retryError instanceof MicrosoftAuthOrScopeError) {
          throw new MicrosoftReconnectRequiredError();
        }
        throw retryError;
      }
    }
  }

  // Push-edits-back increment: structurally identical to deleteRemoteEvent
  // above, including the same refresh-token-rotation write-back Microsoft
  // specifically needs (see that method's own comment on why Google's
  // version doesn't need this extra step) — only the actual API call at the
  // bottom of each `try` differs.
  async updateRemoteEvent(
    calendarAccountId: string,
    externalEventId: string,
    changes: { title?: string; description?: string; startTime?: Date; endTime?: Date },
  ): Promise<void> {
    const account = await this.prisma.calendarAccount.findUniqueOrThrow({ where: { id: calendarAccountId } });
    let accessToken = decryptToken(account.accessTokenEncrypted, this.encryptionKey);

    const callMicrosoft = (token: string) =>
      this.microsoftCalendarClient.updateEvent({
        accessToken: token,
        externalEventId,
        subject: changes.title,
        description: changes.description,
        startTime: changes.startTime,
        endTime: changes.endTime,
      });

    try {
      await callMicrosoft(accessToken);
      return;
    } catch (error) {
      if (!(error instanceof MicrosoftAuthOrScopeError)) throw error;

      this.logger.warn(
        `Microsoft Calendar update failed (${error.status}), attempting token refresh: ${error.message}`,
      );

      let refreshedAccessToken: string;
      let rotatedRefreshToken: string | undefined;
      try {
        const refreshToken = decryptToken(account.refreshTokenEncrypted, this.encryptionKey);
        const refreshed = await this.microsoftOAuth.refreshAccessToken(refreshToken);
        refreshedAccessToken = refreshed.accessToken;
        rotatedRefreshToken = refreshed.refreshToken;
      } catch {
        throw new MicrosoftReconnectRequiredError();
      }

      accessToken = refreshedAccessToken;
      await this.prisma.calendarAccount.update({
        where: { id: calendarAccountId },
        data: {
          accessTokenEncrypted: encryptToken(accessToken, this.encryptionKey),
          ...(rotatedRefreshToken ? { refreshTokenEncrypted: encryptToken(rotatedRefreshToken, this.encryptionKey) } : {}),
        },
      });

      try {
        await callMicrosoft(accessToken);
      } catch (retryError) {
        if (retryError instanceof MicrosoftAuthOrScopeError) {
          throw new MicrosoftReconnectRequiredError();
        }
        throw retryError;
      }
    }
  }
}
