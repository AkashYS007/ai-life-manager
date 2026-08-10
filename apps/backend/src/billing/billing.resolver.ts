import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
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
      return {
        errors: [{ code: 'CHECKOUT_FAILED', message: "We couldn't start checkout. Try again." }],
      };
    }
  }

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
