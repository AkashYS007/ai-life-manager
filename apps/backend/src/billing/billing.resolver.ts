import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { GqlThrottlerGuard } from '../common/guards/gql-throttler.guard';
import { BillingService } from './billing.service';
import { CreateCheckoutSessionPayload } from './models/create-checkout-session.payload';
import { CreateBillingPortalSessionPayload } from './models/create-billing-portal-session.payload';
import { SubscriptionTier } from '../users/models/subscription.model';

// Real Stripe billing integration. Deliberately a separate resolver/module
// from UsersResolver/UsersModule (which still owns the old, simulated
// changeSubscriptionTier mutation) rather than folding these two mutations
// in there — BillingModule needs to import UsersModule (to reuse
// getOrCreateFromAuth), and UsersModule importing BillingModule back would
// be circular; keeping billing as its own downstream module avoids that
// entirely, the same reasoning IntegrationsModule already applies for
// depending on UsersModule/CalendarModule without either of those needing
// to know integrations exists.
@Resolver()
@UseGuards(AuthGuard)
export class BillingResolver {
  constructor(private readonly billingService: BillingService) {}

  // Rate limiting (Production Hardening Sprint 1, 2026-08-29): each of
  // these two mutations calls a real Stripe API (creating a live Checkout
  // Session / Billing Portal Session server-side, respectively) — an
  // unthrottled loop against either was a real, if minor, gap this
  // resolver never closed when the AI-calling endpoints got the same
  // treatment in Update 53. 10/min is generous for genuine use (nobody
  // legitimately opens checkout or billing-portal more than a couple of
  // times a minute) while bounding how many live Stripe API objects one
  // account can spin up in a burst.
  @UseGuards(GqlThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Mutation(() => CreateCheckoutSessionPayload)
  async createCheckoutSession(
    @CurrentAuth() auth: AuthContext,
    @Args('tier', { type: () => SubscriptionTier }) tier: SubscriptionTier,
  ): Promise<CreateCheckoutSessionPayload> {
    try {
      const checkoutUrl = await this.billingService.createCheckoutSession(auth, tier);
      return { checkoutUrl, errors: [] };
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'STRIPE_NOT_CONFIGURED') {
        return {
          errors: [
            {
              code: 'STRIPE_NOT_CONFIGURED',
              message: 'Real billing needs Stripe API keys configured on the server first (see README).',
            },
          ],
        };
      }
      if (message === 'INVALID_TIER') {
        return {
          errors: [{ code: 'INVALID_TIER', message: 'Free has nothing to check out for — pick Plus or Pro.' }],
        };
      }
      if (message === 'PAID_TIERS_DISABLED') {
        return {
          errors: [{ code: 'PAID_TIERS_DISABLED', message: 'Plus and Pro are temporarily unavailable.' }],
        };
      }
      return {
        errors: [{ code: 'CHECKOUT_FAILED', message: "We couldn't start checkout. Try again." }],
      };
    }
  }

  @UseGuards(GqlThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Mutation(() => CreateBillingPortalSessionPayload)
  async createBillingPortalSession(@CurrentAuth() auth: AuthContext): Promise<CreateBillingPortalSessionPayload> {
    try {
      const portalUrl = await this.billingService.createBillingPortalSession(auth);
      return { portalUrl, errors: [] };
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'STRIPE_NOT_CONFIGURED') {
        return {
          errors: [
            {
              code: 'STRIPE_NOT_CONFIGURED',
              message: 'Real billing needs Stripe API keys configured on the server first (see README).',
            },
          ],
        };
      }
      if (message === 'NO_STRIPE_CUSTOMER') {
        return {
          errors: [
            {
              code: 'NO_STRIPE_CUSTOMER',
              message: "You don't have a billing account yet — subscribe to Plus or Pro first.",
            },
          ],
        };
      }
      return {
        errors: [{ code: 'PORTAL_FAILED', message: "We couldn't open billing management. Try again." }],
      };
    }
  }
}
