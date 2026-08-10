import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Subscription } from './models/subscription.model';

// Real Stripe billing integration. The first @ResolveField in this
// codebase — every other GraphQL type so far resolves its fields by plain
// 1:1 property match on whatever object a parent query/mutation already
// returned (see every other resolver's own "cast the raw Prisma row as
// unknown as X" pattern). hasStripeCustomer can't work that way: it's a
// derived boolean, not a real column, and it needs to come out correct
// from every place a Subscription reaches the wire (`me`, `updateProfile`,
// `changeSubscriptionTier`, and the new billing mutations) without each of
// those call sites remembering to compute it by hand — a field resolver
// computes it once, reading the real (and, correctly, still never
// separately exposed on the wire) `stripeCustomerId` column off whatever
// raw Prisma Subscription row is already the parent object.
@Resolver(() => Subscription)
export class SubscriptionResolver {
  @ResolveField(() => Boolean)
  hasStripeCustomer(@Parent() subscription: Subscription & { stripeCustomerId?: string | null }): boolean {
    return !!subscription.stripeCustomerId;
  }
}
