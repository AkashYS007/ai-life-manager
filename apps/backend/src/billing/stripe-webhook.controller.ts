import { Controller, Headers, HttpCode, Logger, Post, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { StripeService } from './stripe.service';
import { BillingService } from './billing.service';

// Plain REST, not GraphQL — same exception the Google/Microsoft OAuth
// callback controllers already are (see their own comments): Stripe posts
// this directly, with no way to attach our GraphQL auth headers, and no
// user session at all (Stripe is the caller, not one of our own
// authenticated clients). Deliberately NOT behind AuthGuard — the HMAC
// signature check below (via StripeService.constructWebhookEvent) is what
// proves this request genuinely came from Stripe, the same role
// `state`/`verifyState` plays for the OAuth callbacks.
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly billingService: BillingService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
    @Res() res: Response,
  ) {
    if (!this.stripeService.isConfigured()) {
      // A webhook arriving for a server with no Stripe keys configured at
      // all shouldn't happen in practice (Stripe wouldn't have anywhere to
      // send it), but responding cleanly rather than crashing keeps this
      // consistent with every other "gracefully do nothing when
      // unconfigured" integration in this codebase.
      return res.status(503).send('Stripe is not configured on this server.');
    }
    if (!signature || !req.rawBody) {
      return res.status(400).send('Missing signature or raw request body.');
    }

    let event;
    try {
      event = this.stripeService.constructWebhookEvent(req.rawBody, signature);
    } catch (error) {
      this.logger.warn(`Stripe webhook signature verification failed: ${(error as Error).message}`);
      return res.status(400).send('Invalid signature.');
    }

    try {
      await this.billingService.handleWebhookEvent(event);
    } catch (error) {
      this.logger.error(`Stripe webhook handler failed for event ${event.id} (${event.type}): ${(error as Error).message}`);
      // A non-2xx response makes Stripe retry this same event later with
      // its own backoff schedule — the right response to a real,
      // transient failure (e.g. the database being briefly unreachable),
      // as opposed to the 400 above for a genuinely invalid request, which
      // Stripe won't usefully retry.
      return res.status(500).send('Webhook handler error.');
    }

    return res.status(200).json({ received: true });
  }
}
