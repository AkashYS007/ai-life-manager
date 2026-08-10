import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CalendarModule } from '../calendar/calendar.module';
import { GoogleOAuthService } from './google/google-oauth.service';
import { GoogleCalendarClient } from './google/google-calendar-client';
import { CalendarAccountsService } from './google/calendar-accounts.service';
import { GoogleOAuthController } from './google/google-oauth.controller';
import { GoogleCalendarWebhookController } from './google/google-calendar-webhook.controller';
import { MicrosoftOAuthService } from './microsoft/microsoft-oauth.service';
import { MicrosoftCalendarClient } from './microsoft/microsoft-calendar-client';
import { MicrosoftCalendarAccountsService } from './microsoft/microsoft-calendar-accounts.service';
import { MicrosoftOAuthController } from './microsoft/microsoft-oauth.controller';
import { MicrosoftCalendarWebhookController } from './microsoft/microsoft-calendar-webhook.controller';
import { AppleCaldavClient } from './apple/apple-caldav-client';
import { AppleCalendarAccountsService } from './apple/apple-calendar-accounts.service';
import { IntegrationsResolver } from './integrations.resolver';

@Module({
  imports: [UsersModule, CalendarModule],
  // Real-time calendar updates (webhooks) increment adds the two webhook
  // controllers alongside the pre-existing OAuth callback controllers —
  // same "plain REST surface reserved for third-party callbacks" module,
  // since both kinds of controller share the exact same
  // GoogleOAuthService/CalendarAccountsService (and their Microsoft
  // equivalents) providers already registered below.
  controllers: [
    GoogleOAuthController,
    GoogleCalendarWebhookController,
    MicrosoftOAuthController,
    MicrosoftCalendarWebhookController,
  ],
  providers: [
    GoogleOAuthService,
    GoogleCalendarClient,
    CalendarAccountsService,
    MicrosoftOAuthService,
    MicrosoftCalendarClient,
    MicrosoftCalendarAccountsService,
    AppleCaldavClient,
    AppleCalendarAccountsService,
    IntegrationsResolver,
  ],
  // Real-time calendar updates (webhooks) increment — CalendarAccountsService/
  // MicrosoftCalendarAccountsService exported so SchedulerModule can inject
  // them for the renewal cron job (renewCalendarWebhooks), the same
  // "export the service, not just use it internally" precedent
  // PlannerModule already sets for AnthropicClient.
  exports: [CalendarAccountsService, MicrosoftCalendarAccountsService],
})
export class IntegrationsModule {}
