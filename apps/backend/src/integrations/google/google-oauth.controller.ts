import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { GoogleOAuthService } from './google-oauth.service';
import { CalendarAccountsService } from './calendar-accounts.service';
import { peekReturnTo } from '../oauth-state';

// Plain REST, not GraphQL — Google redirects the user's browser here
// directly with no way to attach our GraphQL auth headers, exactly the
// exception the API Design Document §1 calls out ("the small REST surface
// reserved for third-party webhooks"). This endpoint is intentionally NOT
// behind AuthGuard: the caller is Google's redirect, not our own client,
// and the signed `state` param (oauth-state.ts) is what proves which of our
// users this callback belongs to.
@Controller('auth/google')
export class GoogleOAuthController {
  private readonly logger = new Logger(GoogleOAuthController.name);

  constructor(
    private readonly googleOAuth: GoogleOAuthService,
    private readonly calendarAccounts: CalendarAccountsService,
    private readonly config: ConfigService,
  ) {}

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') googleError: string | undefined,
    @Res() res: Response,
  ) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL');

    // Fix onboarding calendar-connect redirect increment: pick the
    // destination page from `state` before even knowing whether this
    // callback succeeded — Google echoes `state` back on every callback,
    // including "user clicked Cancel on the consent screen" and other
    // error cases, so this only ever falls back to `/calendar` (the
    // original, only-ever destination before this increment) when `state`
    // is missing entirely or was never signed by us in the first place.
    // `peekReturnTo` is deliberately non-verifying (see its own comment in
    // oauth-state.ts) — the only thing at stake here is which of two known
    // pages someone lands back on, not anything security-sensitive.
    const destination = peekReturnTo(state) === 'onboarding' ? '/onboarding' : '/calendar';

    if (googleError || !code || !state) {
      return res.redirect(`${frontendUrl}${destination}?googleConnect=error`);
    }

    try {
      const { userId } = this.googleOAuth.verifyState(state);
      await this.calendarAccounts.connect(userId, code);
      return res.redirect(`${frontendUrl}${destination}?googleConnect=success`);
    } catch (error) {
      this.logger.warn(`Google Calendar connect failed: ${(error as Error).message}`);
      return res.redirect(`${frontendUrl}${destination}?googleConnect=error`);
    }
  }
}
