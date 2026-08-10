import { Body, Controller, Logger, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MicrosoftCalendarAccountsService } from './microsoft-calendar-accounts.service';

// Real-time calendar updates (webhooks) increment. Plain REST, not GraphQL —
// same exception as GoogleCalendarWebhookController right next to this file
// (see that controller's own comment). Deliberately NOT behind AuthGuard —
// `clientState` verification inside MicrosoftCalendarAccountsService.
// syncBySubscription is what proves a request is genuinely about a real
// registered subscription.
//
// Two genuinely different request shapes land on this one endpoint, unlike
// Google's side: Graph's synchronous validation handshake (sent as part of
// MicrosoftCalendarAccountsService.registerWebhook's own subscriptions.create
// call, before a subscription even exists) and real change notifications
// (sent afterward, once the subscription is live). Both are POSTs to the
// same URL — only the presence of the `validationToken` query param tells
// them apart.
@Controller('webhooks/microsoft/calendar')
export class MicrosoftCalendarWebhookController {
  private readonly logger = new Logger(MicrosoftCalendarWebhookController.name);

  constructor(private readonly microsoftCalendarAccounts: MicrosoftCalendarAccountsService) {}

  @Post()
  async handleNotification(
    @Query('validationToken') validationToken: string | undefined,
    @Body() body: { value?: Array<{ subscriptionId?: string; clientState?: string }> } | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // Graph's own documented handshake: respond within 10 seconds with a
    // plain-text 200 body containing exactly the token it sent — not JSON,
    // not wrapped in any object. Skipping this (or getting the content-type
    // wrong) makes Graph refuse to create the subscription at all, which is
    // exactly why this is handled unconditionally first, before anything
    // else on this endpoint even looks at the request body.
    if (validationToken !== undefined) {
      res.status(200).type('text/plain').send(validationToken);
      return;
    }

    // Real change notifications carry no full event data either — just
    // enough (subscriptionId, clientState, changeType, a resource path) to
    // know *that* something changed and prove *which* subscription it's
    // for; a batch can contain more than one notification in a single
    // POST, so every entry is processed rather than just the first.
    const notifications = body?.value ?? [];
    for (const notification of notifications) {
      const subscriptionId = notification?.subscriptionId;
      const clientState = notification?.clientState;
      if (!subscriptionId || !clientState) continue;
      try {
        await this.microsoftCalendarAccounts.syncBySubscription(subscriptionId, clientState);
      } catch (error) {
        this.logger.warn(`Microsoft Calendar webhook sync failed: ${(error as Error).message}`);
      }
    }

    // 202 Accepted, per Graph's own documented expectation for notification
    // acknowledgment (distinct from the plain 200 the validation handshake
    // above needs) — always returned regardless of per-notification outcome,
    // same "don't let a transient failure risk Graph disabling the whole
    // subscription" reasoning GoogleCalendarWebhookController's own always-200
    // response documents for its side.
    res.status(202).json({ received: true });
  }
}
