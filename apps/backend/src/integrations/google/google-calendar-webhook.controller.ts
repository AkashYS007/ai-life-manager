import { Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { CalendarAccountsService } from './calendar-accounts.service';

// Real-time calendar updates (webhooks) increment. Plain REST, not GraphQL —
// same exception the OAuth callback controllers and the Stripe webhook
// controller already are (see their own comments): Google's own servers
// POST here directly, with no GraphQL auth headers to attach, and no user
// session at all. Deliberately NOT behind AuthGuard — the channel/resource
// id + verification token check inside CalendarAccountsService.syncByChannel
// is what proves this request is genuinely about a real registered channel,
// the same role signature/state verification plays for Stripe/OAuth.
//
// Google's own notification carries no event data at all — just headers
// identifying which channel/resource changed — so this controller's whole
// job is picking those headers out and handing them to syncByChannel, which
// does the actual verification and the actual sync.
@Controller('webhooks/google/calendar')
export class GoogleCalendarWebhookController {
  private readonly logger = new Logger(GoogleCalendarWebhookController.name);

  constructor(private readonly calendarAccounts: CalendarAccountsService) {}

  @Post()
  @HttpCode(200)
  async handleNotification(
    @Headers('x-goog-channel-id') channelId: string | undefined,
    @Headers('x-goog-resource-id') resourceId: string | undefined,
    @Headers('x-goog-resource-state') resourceState: string | undefined,
    @Headers('x-goog-channel-token') token: string | undefined,
  ): Promise<{ received: boolean }> {
    // 'sync' is Google's own one-time handshake message, sent the moment
    // watchEvents() succeeds, confirming the channel is live — not a real
    // change to react to. Everything else ('exists', and defensively any
    // value this app doesn't specifically recognize) triggers a real sync;
    // Google's Calendar API only ever sends 'exists' for a genuine change
    // notification, but treating "not 'sync'" as "go sync" rather than
    // matching 'exists' exactly is the more forgiving, still-safe choice —
    // a spurious extra sync costs nothing, a missed real one is the actual
    // failure mode worth avoiding.
    if (!channelId || !resourceId || !token || resourceState === 'sync') {
      return { received: true };
    }

    // Always 200, regardless of outcome — repeated non-2xx responses are
    // how Google eventually disables a channel entirely, and a missed
    // real-time push here is recoverable (the next push, or a manual "Sync
    // now", catches up) in a way an app-initiated Stripe payment event
    // isn't — the opposite trade-off StripeWebhookController's own 500 (to
    // trigger Stripe's retry) makes on purpose for its own, higher-stakes
    // case.
    try {
      await this.calendarAccounts.syncByChannel(channelId, resourceId, token);
    } catch (error) {
      this.logger.warn(`Google Calendar webhook sync failed: ${(error as Error).message}`);
    }
    return { received: true };
  }
}
