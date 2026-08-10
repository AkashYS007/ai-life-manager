import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum SubscriptionTier {
  FREE = 'FREE',
  PLUS = 'PLUS',
  PRO = 'PRO',
}
registerEnumType(SubscriptionTier, { name: 'SubscriptionTier' });

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  TRIALING = 'TRIALING',
}
registerEnumType(SubscriptionStatus, { name: 'SubscriptionStatus' });

// Mirrors Subscription in the API Design Document §4.2, but exposed under
// the GraphQL type name BillingSubscription rather than Subscription.
// GraphQL reserves the name "Subscription" for the schema's real-time
// subscription root (API Design Document §7 — chatMessageStreamed,
// planRunUpdated, etc.); reusing it here for the billing model would
// silently collide with that root type once those subscriptions are added
// in a later increment. The field name on User (`subscription`) is
// unchanged — only the underlying GraphQL type name differs from the doc.
@ObjectType('BillingSubscription')
export class Subscription {
  @Field(() => SubscriptionTier)
  tier!: SubscriptionTier;

  @Field(() => SubscriptionStatus)
  status!: SubscriptionStatus;

  @Field({ nullable: true })
  currentPeriodEnd?: Date;
}
