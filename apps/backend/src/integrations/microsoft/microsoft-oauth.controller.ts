import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { MicrosoftOAuthService } from './microsoft-oauth.service';
import { MicrosoftCalendarAccountsService } from './microsoft-calendar-accounts.service';
import { peekReturnTo } from '../oauth-state';

// Mirrors google-oauth.controller.ts exactly — plain REST (not GraphQL),
// not behind AuthGuard, same reasoning: Microsoft redirects the user's
// browser here directly, and the signed `state` param is what proves which
// of our users this callback belongs to.
@Controller('auth/microsoft')
export class MicrosoftOAuthController {
  private readonly logger = new Logger(MicrosoftOAuthController.name);

  constructor(
    private readonly microsoftOAuth: MicrosoftOAuthService,
    private readonly calendarAccounts: MicrosoftCalendarAccountsService,
    private readonly config: ConfigService,
  ) {}

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') microsoftError: string | undefined,
    @Res() res: Response,
  ) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL');

    // Fix onboarding calendar-connect redirect increment: same
    // destination-from-state logic as google-oauth.controller.ts — see
    // that file's own comment for why this is safe to do before (and even
    // without) a successful `verifyState`.
    const destination = peekReturnTo(state) === 'onboarding' ? '/onboarding' : '/calendar';

    if (microsoftError || !code || !state) {
      return res.redirect(`${frontendUrl}${destination}?microsoftConnect=error`);
    }

    try {
      const { userId } = this.microsoftOAuth.verifyState(state);
      await this.calendarAccounts.connect(userId, code);
      return res.redirect(`${frontendUrl}${destination}?microsoftConnect=success`);
    } catch (error) {
      this.logger.warn(`Microsoft Calendar connect failed: ${(error as Error).message}`);
      return res.redirect(`${frontendUrl}${destination}?microsoftConnect=error`);
    }
  }
}
