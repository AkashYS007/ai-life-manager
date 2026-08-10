import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { CalendarAccount } from './models/calendar-account.model';
import {
  StartGoogleCalendarConnectionPayload,
  DisconnectCalendarAccountPayload,
  SyncGoogleCalendarPayload,
  StartMicrosoftCalendarConnectionPayload,
  SyncMicrosoftCalendarPayload,
  ConnectAppleCalendarPayload,
  SyncAppleCalendarPayload,
} from './models/calendar-account.payload';
import { GoogleOAuthService } from './google/google-oauth.service';
import { CalendarAccountsService } from './google/calendar-accounts.service';
import { MicrosoftOAuthService } from './microsoft/microsoft-oauth.service';
import { MicrosoftCalendarAccountsService } from './microsoft/microsoft-calendar-accounts.service';
import { AppleCalendarAccountsService, AppleAuthFailedError } from './apple/apple-calendar-accounts.service';
import { ConnectAppleCalendarInput } from './apple/dto/connect-apple-calendar.input';

// Real-time calendar updates (webhooks) increment. `webhookExpiresAt` is
// the one stored signal both providers' registration paths keep current
// (see CalendarAccountsService/MicrosoftCalendarAccountsService's own
// registerWebhook) — "enabled" means a real, not-yet-expired channel/
// subscription is on file, not just "was ever registered once."
function toGraphCalendarAccount(account: any): CalendarAccount {
  return {
    ...account,
    realtimeSyncEnabled: account.webhookExpiresAt ? new Date(account.webhookExpiresAt) > new Date() : false,
  } as CalendarAccount;
}

@Resolver()
@UseGuards(AuthGuard)
export class IntegrationsResolver {
  constructor(
    private readonly usersService: UsersService,
    private readonly googleOAuth: GoogleOAuthService,
    private readonly calendarAccounts: CalendarAccountsService,
    private readonly microsoftOAuth: MicrosoftOAuthService,
    private readonly microsoftCalendarAccounts: MicrosoftCalendarAccountsService,
    private readonly appleCalendarAccounts: AppleCalendarAccountsService,
  ) {}

  @Query(() => CalendarAccount, { nullable: true })
  async googleCalendarAccount(@CurrentAuth() auth: AuthContext): Promise<CalendarAccount | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    const account = await this.calendarAccounts.getForUser(user.id);
    return account ? toGraphCalendarAccount(account) : null;
  }

  @Mutation(() => StartGoogleCalendarConnectionPayload)
  async startGoogleCalendarConnection(
    @CurrentAuth() auth: AuthContext,
    // Fix onboarding calendar-connect redirect increment: optional, and
    // deliberately whitelisted rather than passed straight through — see
    // `sanitizeReturnTo` below and oauth-state.ts's own comment on why a
    // free-form string here would be an open-redirect risk otherwise.
    @Args('returnTo', { nullable: true }) returnTo?: string,
  ): Promise<StartGoogleCalendarConnectionPayload> {
    if (!this.googleOAuth.isConfigured()) {
      return {
        errors: [
          {
            code: 'GOOGLE_NOT_CONFIGURED',
            message:
              'Google Calendar sync needs Google Cloud credentials configured on the server first (see README).',
          },
        ],
      };
    }
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return { authUrl: this.googleOAuth.buildAuthUrl(user.id, sanitizeReturnTo(returnTo)), errors: [] };
  }

  @Mutation(() => DisconnectCalendarAccountPayload)
  async disconnectGoogleCalendar(@CurrentAuth() auth: AuthContext): Promise<DisconnectCalendarAccountPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const disconnected = await this.calendarAccounts.disconnect(user.id);
      return { disconnected, errors: [] };
    } catch {
      return {
        disconnected: false,
        errors: [{ code: 'DISCONNECT_FAILED', message: "We couldn't disconnect that account. Try again." }],
      };
    }
  }

  @Mutation(() => SyncGoogleCalendarPayload)
  async syncGoogleCalendarNow(@CurrentAuth() auth: AuthContext): Promise<SyncGoogleCalendarPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const { syncedCount } = await this.calendarAccounts.syncNow(user.id);
      const account = await this.calendarAccounts.getForUser(user.id);
      return { account: account ? toGraphCalendarAccount(account) : undefined, syncedEventCount: syncedCount, errors: [] };
    } catch {
      return {
        errors: [{ code: 'SYNC_FAILED', message: "We couldn't sync your Google Calendar. Try again." }],
      };
    }
  }

  // --- Microsoft (Outlook/365) — mirrors the three Google methods above
  // exactly; disconnectMicrosoftCalendar reuses the same
  // DisconnectCalendarAccountPayload since disconnecting is identical
  // regardless of provider. ---------------------------------------------

  @Query(() => CalendarAccount, { nullable: true })
  async microsoftCalendarAccount(@CurrentAuth() auth: AuthContext): Promise<CalendarAccount | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    const account = await this.microsoftCalendarAccounts.getForUser(user.id);
    return account ? toGraphCalendarAccount(account) : null;
  }

  @Mutation(() => StartMicrosoftCalendarConnectionPayload)
  async startMicrosoftCalendarConnection(
    @CurrentAuth() auth: AuthContext,
    @Args('returnTo', { nullable: true }) returnTo?: string,
  ): Promise<StartMicrosoftCalendarConnectionPayload> {
    if (!this.microsoftOAuth.isConfigured()) {
      return {
        errors: [
          {
            code: 'MICROSOFT_NOT_CONFIGURED',
            message:
              'Microsoft Calendar sync needs Azure AD app credentials configured on the server first (see README).',
          },
        ],
      };
    }
    const user = await this.usersService.getOrCreateFromAuth(auth);
    return { authUrl: this.microsoftOAuth.buildAuthUrl(user.id, sanitizeReturnTo(returnTo)), errors: [] };
  }

  @Mutation(() => DisconnectCalendarAccountPayload)
  async disconnectMicrosoftCalendar(@CurrentAuth() auth: AuthContext): Promise<DisconnectCalendarAccountPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const disconnected = await this.microsoftCalendarAccounts.disconnect(user.id);
      return { disconnected, errors: [] };
    } catch {
      return {
        disconnected: false,
        errors: [{ code: 'DISCONNECT_FAILED', message: "We couldn't disconnect that account. Try again." }],
      };
    }
  }

  @Mutation(() => SyncMicrosoftCalendarPayload)
  async syncMicrosoftCalendarNow(@CurrentAuth() auth: AuthContext): Promise<SyncMicrosoftCalendarPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const { syncedCount } = await this.microsoftCalendarAccounts.syncNow(user.id);
      const account = await this.microsoftCalendarAccounts.getForUser(user.id);
      return { account: account ? toGraphCalendarAccount(account) : undefined, syncedEventCount: syncedCount, errors: [] };
    } catch {
      return {
        errors: [{ code: 'SYNC_FAILED', message: "We couldn't sync your Microsoft Calendar. Try again." }],
      };
    }
  }

  // --- Apple (CalDAV) — genuinely different connect flow than
  // Google/Microsoft: a direct Apple ID + app-specific password submission
  // instead of an OAuth redirect (see ConnectAppleCalendarInput and the
  // README's "Picking up" section for how to generate that password), so
  // there's no separate "start connection" mutation returning an authUrl —
  // connectAppleCalendar does the whole thing in one call. Disconnecting
  // reuses the same DisconnectCalendarAccountPayload as Google/Microsoft,
  // same as Microsoft reused Google's. -----------------------------------

  @Query(() => CalendarAccount, { nullable: true })
  async appleCalendarAccount(@CurrentAuth() auth: AuthContext): Promise<CalendarAccount | null> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    const account = await this.appleCalendarAccounts.getForUser(user.id);
    return account as unknown as CalendarAccount | null;
  }

  @Mutation(() => ConnectAppleCalendarPayload)
  async connectAppleCalendar(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: ConnectAppleCalendarInput,
  ): Promise<ConnectAppleCalendarPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const account = await this.appleCalendarAccounts.connect(user.id, input.appleId, input.appSpecificPassword);
      return { account: account as unknown as CalendarAccount, errors: [] };
    } catch (error) {
      if (error instanceof AppleAuthFailedError) {
        return { errors: [{ code: 'APPLE_AUTH_FAILED', message: error.message }] };
      }
      return { errors: [{ code: 'CONNECT_FAILED', message: "We couldn't connect that Apple Calendar. Try again." }] };
    }
  }

  @Mutation(() => DisconnectCalendarAccountPayload)
  async disconnectAppleCalendar(@CurrentAuth() auth: AuthContext): Promise<DisconnectCalendarAccountPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const disconnected = await this.appleCalendarAccounts.disconnect(user.id);
      return { disconnected, errors: [] };
    } catch {
      return {
        disconnected: false,
        errors: [{ code: 'DISCONNECT_FAILED', message: "We couldn't disconnect that account. Try again." }],
      };
    }
  }

  @Mutation(() => SyncAppleCalendarPayload)
  async syncAppleCalendarNow(@CurrentAuth() auth: AuthContext): Promise<SyncAppleCalendarPayload> {
    try {
      const user = await this.usersService.getOrCreateFromAuth(auth);
      const { syncedCount } = await this.appleCalendarAccounts.syncNow(user.id);
      const account = await this.appleCalendarAccounts.getForUser(user.id);
      return { account: account as unknown as CalendarAccount, syncedEventCount: syncedCount, errors: [] };
    } catch {
      return {
        errors: [{ code: 'SYNC_FAILED', message: "We couldn't sync your Apple Calendar. Try again." }],
      };
    }
  }
}

// Fix onboarding calendar-connect redirect increment: a client-supplied
// GraphQL argument, so it has to be whitelisted rather than trusted — the
// only value that ever changes behavior is the literal `'onboarding'`
// (see the two OAuth controllers' own `peekReturnTo` usage), and anything
// else — a typo, an unrelated value, `undefined` — is treated exactly like
// not passing it at all, falling back to the original, only-ever-existed
// `/calendar` destination.
function sanitizeReturnTo(returnTo: string | undefined): string | undefined {
  return returnTo === 'onboarding' ? 'onboarding' : undefined;
}
