import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { SubscriptionTier } from '../users/models/subscription.model';

// Real Stripe billing integration. Talks to the real `stripe` npm SDK
// (unlike GoogleOAuthService/MicrosoftOAuthService, which hand-roll plain
// `fetch` calls against a handful of REST endpoints — Stripe's API surface
// here (Checkout Sessions, Billing Portal Sessions, webhook signature
// verification) is wide enough, and security-sensitive enough on the
// signature-verification piece specifically, that reimplementing it by
// hand the way those two do isn't the right tradeoff the way it was for a
// three-endpoint OAuth flow).
@Injectable()
export class StripeService {
  private readonly stripe: Stripe | null;
  private readonly webhookSecret?: string;
  private readonly priceIdByTier: Partial<Record<SubscriptionTier, string>>;

  constructor(private readonly config: ConfigService) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    this.priceIdByTier = {
      PLUS: this.config.get<string>('STRIPE_PRICE_ID_PLUS'),
      PRO: this.config.get<string>('STRIPE_PRICE_ID_PRO'),
    };
    // Same "construct once at startup, null when unconfigured" shape as
    // AnthropicClient — every call site below checks isConfigured() first
    // rather than letting a null-secret-key Stripe() constructor call
    // throw somewhere deep in a request.
    this.stripe = secretKey ? new Stripe(secretKey) : null;
  }

  isConfigured(): boolean {
    return !!(this.stripe && this.webhookSecret && this.priceIdByTier.PLUS && this.priceIdByTier.PRO);
  }

  private priceIdForTier(tier: SubscriptionTier): string | undefined {
    return this.priceIdByTier[tier];
  }

  tierForPriceId(priceId: string): SubscriptionTier | null {
    const entry = (Object.entries(this.priceIdByTier) as Array<[SubscriptionTier, string | undefined]>).find(
      ([, id]) => id === priceId,
    );
    return entry ? entry[0] : null;
  }

  // Checkout is for starting a brand-new paid subscription — Stripe's own
  // hosted, PCI-scope-free payment page. `metadata.userId` on both the
  // Session and the Subscription it creates (via `subscription_data`) is
  // the load-bearing piece: it's how the webhook handler below maps a
  // `checkout.session.completed`/`customer.subscription.updated` event
  // back to one of our own users without needing a lookup table of our
  // own, the same "let the third party carry the correlation id" pattern
  // client-generated `requestId` already established for chat streaming.
  async createCheckoutSession(params: {
    userId: string;
    userEmail?: string;
    tier: SubscriptionTier;
    existingStripeCustomerId?: string | null;
    frontendUrl: string;
  }): Promise<string> {
    if (!this.stripe) throw new Error('STRIPE_NOT_CONFIGURED');
    const priceId = this.priceIdForTier(params.tier);
    if (!priceId) throw new Error('INVALID_TIER');

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Reuse the existing Stripe Customer once one exists (set the first
      // time anyone here ever checks out) rather than letting Stripe create
      // a second, orphaned customer for the same person on a later
      // upgrade/re-subscribe.
      ...(params.existingStripeCustomerId
        ? { customer: params.existingStripeCustomerId }
        : { customer_email: params.userEmail }),
      metadata: { userId: params.userId },
      subscription_data: { metadata: { userId: params.userId } },
      success_url: `${params.frontendUrl}/settings?checkout=success`,
      cancel_url: `${params.frontendUrl}/settings?checkout=cancel`,
    });
    if (!session.url) throw new Error('CHECKOUT_SESSION_HAS_NO_URL');
    return session.url;
  }

  // The Billing Portal is Stripe's own hosted UI for everything after the
  // first subscribe — upgrade/downgrade between prices, cancel, update the
  // payment method, view past invoices. Deliberately not reimplemented as
  // custom mutations here (a "change my existing subscription's price"
  // action needs real proration decisions Stripe's own portal already
  // handles correctly) — same "point at the provider's own hosted flow
  // rather than rebuild it" choice the Google/Microsoft "Connect" buttons
  // already made for OAuth consent screens. Requires the Stripe Dashboard's
  // own portal configuration to have the Plus/Pro products enabled for
  // switching — a real one-time operational setup step outside this
  // codebase, documented in the README.
  async createBillingPortalSession(stripeCustomerId: string, frontendUrl: string): Promise<string> {
    if (!this.stripe) throw new Error('STRIPE_NOT_CONFIGURED');
    const session = await this.stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${frontendUrl}/settings`,
    });
    return session.url;
  }

  // Retrieves the subscription with its price expanded — used right after
  // `checkout.session.completed` to learn which tier/period-end to write,
  // since that event itself only carries ids, not the line-item price.
  async retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    if (!this.stripe) throw new Error('STRIPE_NOT_CONFIGURED');
    return this.stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
  }

  // Raw `Buffer`, not a parsed body — see main.ts's own `rawBody: true`
  // comment for why. Throws (a real `Stripe.errors.StripeSignatureVerificationError`)
  // on a bad/forged signature; the webhook controller below is the only
  // caller, and it turns that throw into a 400 rather than letting a
  // fabricated event ever reach handleWebhookEvent.
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.stripe || !this.webhookSecret) throw new Error('STRIPE_NOT_CONFIGURED');
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }
}
