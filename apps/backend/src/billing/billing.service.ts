import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { StripeService } from './stripe.service';
import { SubscriptionTier } from '../users/models/subscription.model';

// Real Stripe billing integration. Orchestrates PrismaService + StripeService
// + UsersService — the mutation-facing half (createCheckoutSession/
// createBillingPortalSession) reuses UsersService.getOrCreateFromAuth
// exactly the way every other mutation in this codebase does rather than
// re-deriving the current user a second way; the webhook-facing half
// (handleWebhookEvent) is the real source of truth for tier/status/
// currentPeriodEnd from here on — changeSubscriptionTier (UsersService)
// remains untouched as the graceful-degradation fallback for a server with
// no Stripe keys configured, exactly like Chat/the AI planner keep working
// in a lesser form without an Anthropic key rather than the whole feature
// disappearing.
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly stripeService: StripeService,
    private readonly config: ConfigService,
  ) {}

  async createCheckoutSession(auth: AuthContext, tier: SubscriptionTier): Promise<string> {
    if (tier === SubscriptionTier.FREE) throw new Error('INVALID_TIER');
    const user = await this.usersService.getOrCreateFromAuth(auth);
    const frontendUrl = this.config.get<string>('FRONTEND_URL')!;
    return this.stripeService.createCheckoutSession({
      userId: user.id,
      userEmail: user.email,
      tier,
      existingStripeCustomerId: user.subscription?.stripeCustomerId,
      frontendUrl,
    });
  }

  async createBillingPortalSession(auth: AuthContext): Promise<string> {
    const user = await this.usersService.getOrCreateFromAuth(auth);
    const stripeCustomerId = user.subscription?.stripeCustomerId;
    if (!stripeCustomerId) throw new Error('NO_STRIPE_CUSTOMER');
    const frontendUrl = this.config.get<string>('FRONTEND_URL')!;
    return this.stripeService.createBillingPortalSession(stripeCustomerId, frontendUrl);
  }

  // The webhook is the only place tier/status/currentPeriodEnd are ever
  // written for a real Stripe-backed subscription — never trust the
  // Checkout Session's own immediate return value for this, since the
  // person's browser redirecting to success_url only proves Stripe
  // *started* processing the subscription, not that it's actually active
  // yet (a card can still be declined, 3D Secure can still be pending) —
  // exactly the same "the redirect isn't the source of truth, the
  // provider's own follow-up notification is" reasoning
  // GoogleOAuthController's callback already applies (it saves tokens, but
  // never assumes calendar data is synced until a real sync call
  // succeeds).
  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        if (!userId || !subscriptionId || !customerId) {
          this.logger.warn(`checkout.session.completed missing userId/subscription/customer (session ${session.id})`);
          return;
        }
        await this.syncSubscriptionFromStripe(userId, subscriptionId, customerId);
        return;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId;
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
        if (!userId) {
          // A subscription created outside our own Checkout flow (e.g.
          // directly in the Stripe Dashboard) would have no userId
          // metadata — nothing safe to do with it here, so it's logged
          // and skipped rather than guessed at.
          this.logger.warn(`${event.type} with no userId metadata (subscription ${subscription.id})`);
          return;
        }
        await this.applySubscriptionState(userId, customerId, subscription);
        return;
      }

      default:
        // Every other event type Stripe might send (invoice.*, payment_intent.*,
        // and so on) is intentionally a no-op here — this integration only
        // needs to know the subscription's own current state, not every
        // individual billing event that led to it, the same "only handle
        // the events you actually act on, ignore the rest" scoping every
        // webhook consumer should apply.
        return;
    }
  }

  private async syncSubscriptionFromStripe(userId: string, subscriptionId: string, customerId: string): Promise<void> {
    const subscription = await this.stripeService.retrieveSubscription(subscriptionId);
    await this.applySubscriptionState(userId, customerId, subscription);
  }

  private async applySubscriptionState(userId: string, customerId: string, subscription: Stripe.Subscription): Promise<void> {
    const priceId = subscription.items.data[0]?.price?.id;
    const tier = priceId ? this.stripeService.tierForPriceId(priceId) : null;
    if (!tier) {
      this.logger.warn(`Subscription ${subscription.id} has an unrecognized price ${priceId ?? '(none)'} — leaving tier untouched.`);
    }

    await this.prisma.subscription.update({
      where: { userId },
      data: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        ...(tier ? { tier: tier as any } : {}),
        status: mapStripeStatus(subscription.status),
        currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
      },
    });
  }
}

// Stripe's own status strings are lowercase and finer-grained
// (incomplete/incomplete_expired/trialing/active/past_due/canceled/
// unpaid/paused) than this app's four-value SubscriptionStatus enum — a
// real, deliberate narrowing, not an oversight: everything this app
// currently does with `status` (Settings' own read-only display) only
// ever needed to distinguish "fine," "trialing," "in trouble," and "gone,"
// so incomplete/incomplete_expired/unpaid/paused all collapse into
// PAST_DUE (all mean "not currently paying, not yet definitively
// canceled") rather than growing the enum for distinctions nothing reads
// yet.
function mapStripeStatus(status: Stripe.Subscription.Status): 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIALING' {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'canceled':
      return 'CANCELED';
    default:
      return 'PAST_DUE';
  }
}
