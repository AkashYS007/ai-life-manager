import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleCalendarClient, GoogleAuthOrScopeError } from './google-calendar-client';
import { encryptToken, decryptToken } from '../crypto/token-cipher';

// Thrown when a write (delete, or — since the push-edits-back increment —
// update too) to Google Calendar fails because the connected account's
// tokens don't actually grant write access — almost always because the
// account was connected before the original two-way-sync increment (back
// when the OAuth scope was calendar.readonly) and hasn't been reconnected
// since. The resolver layer maps this to a distinct RECONNECT_REQUIRED
// error code rather than a generic failure, since "try again" would never
// fix it — only reconnecting would.
export class GoogleReconnectRequiredError extends Error {
  constructor() {
    super('This Google Calendar connection only has read access. Reconnect it to allow editing or deleting synced events.');
    this.name = 'GoogleReconnectRequiredError';
  }
}

// Owns the write half of the Google Calendar integration (CalendarAccountsService
// owns the read/pull half, in the sibling IntegrationsModule). Kept as its
// own service specifically so CalendarModule can depend on it directly
// without depending on all of IntegrationsModule — IntegrationsModule
// already depends on CalendarModule (for writing synced events locally
// during a pull), so CalendarModule importing IntegrationsModule back would
// be a circular module dependency. This service and its own dependencies
// (GoogleOAuthService, GoogleCalendarClient) have no dependency on
// CalendarModule, so the graph stays one-directional.
@Injectable()
export class GoogleCalendarWriteService {
  private readonly logger = new Logger(GoogleCalendarWriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly googleOAuth: GoogleOAuthService,
    private readonly googleCalendarClient: GoogleCalendarClient,
  ) {}

  private get encryptionKey(): string {
    return this.config.get<string>('TOKEN_ENCRYPTION_KEY')!;
  }

  // Deletes an event on the Google side. Idempotent — an event that's
  // already gone on Google's end is treated as success (see
  // GoogleCalendarClient.deleteEvent's 404/410 handling), not an error.
  async deleteRemoteEvent(calendarAccountId: string, externalEventId: string): Promise<void> {
    const account = await this.prisma.calendarAccount.findUniqueOrThrow({ where: { id: calendarAccountId } });
    let accessToken = decryptToken(account.accessTokenEncrypted, this.encryptionKey);

    try {
      await this.googleCalendarClient.deleteEvent({ accessToken, externalEventId });
      return;
    } catch (error) {
      if (!(error instanceof GoogleAuthOrScopeError)) throw error;

      // 401 almost always means an expired access token (they expire
      // hourly) — refresh once and retry, same pattern as
      // CalendarAccountsService.sync(). 403 is more often a genuine
      // insufficient-scope rejection, but attempting the same refresh+retry
      // for both is cheap and harmless: a 403 caused by an expired token
      // succeeds after refresh, and a 403 caused by a missing scope just
      // fails the same way twice — exactly the signal we want, since a
      // refreshed token carries the same originally-consented scope.
      this.logger.warn(
        `Google Calendar delete failed (${error.status}), attempting token refresh: ${error.message}`,
      );

      let refreshedAccessToken: string;
      try {
        const refreshToken = decryptToken(account.refreshTokenEncrypted, this.encryptionKey);
        const refreshed = await this.googleOAuth.refreshAccessToken(refreshToken);
        refreshedAccessToken = refreshed.accessToken;
      } catch {
        // Refresh token itself is dead (revoked/expired) — no amount of
        // retrying fixes this, only a real reconnect does.
        throw new GoogleReconnectRequiredError();
      }

      accessToken = refreshedAccessToken;
      await this.prisma.calendarAccount.update({
        where: { id: calendarAccountId },
        data: { accessTokenEncrypted: encryptToken(accessToken, this.encryptionKey) },
      });

      try {
        await this.googleCalendarClient.deleteEvent({ accessToken, externalEventId });
      } catch (retryError) {
        if (retryError instanceof GoogleAuthOrScopeError) {
          throw new GoogleReconnectRequiredError();
        }
        throw retryError;
      }
    }
  }

  // Push-edits-back increment: structurally identical to deleteRemoteEvent
  // above (same account lookup, same 401/403-triggers-a-refresh-then-retry
  // shape, same GoogleReconnectRequiredError if the refresh token itself is
  // dead) — only the actual API call at the bottom of each `try` differs.
  async updateRemoteEvent(
    calendarAccountId: string,
    externalEventId: string,
    changes: { title?: string; description?: string; startTime?: Date; endTime?: Date },
  ): Promise<void> {
    const account = await this.prisma.calendarAccount.findUniqueOrThrow({ where: { id: calendarAccountId } });
    let accessToken = decryptToken(account.accessTokenEncrypted, this.encryptionKey);

    const callGoogle = (token: string) =>
      this.googleCalendarClient.updateEvent({
        accessToken: token,
        externalEventId,
        summary: changes.title,
        description: changes.description,
        startTime: changes.startTime,
        endTime: changes.endTime,
      });

    try {
      await callGoogle(accessToken);
      return;
    } catch (error) {
      if (!(error instanceof GoogleAuthOrScopeError)) throw error;

      this.logger.warn(
        `Google Calendar update failed (${error.status}), attempting token refresh: ${error.message}`,
      );

      let refreshedAccessToken: string;
      try {
        const refreshToken = decryptToken(account.refreshTokenEncrypted, this.encryptionKey);
        const refreshed = await this.googleOAuth.refreshAccessToken(refreshToken);
        refreshedAccessToken = refreshed.accessToken;
      } catch {
        throw new GoogleReconnectRequiredError();
      }

      accessToken = refreshedAccessToken;
      await this.prisma.calendarAccount.update({
        where: { id: calendarAccountId },
        data: { accessTokenEncrypted: encryptToken(accessToken, this.encryptionKey) },
      });

      try {
        await callGoogle(accessToken);
      } catch (retryError) {
        if (retryError instanceof GoogleAuthOrScopeError) {
          throw new GoogleReconnectRequiredError();
        }
        throw retryError;
      }
    }
  }
}
