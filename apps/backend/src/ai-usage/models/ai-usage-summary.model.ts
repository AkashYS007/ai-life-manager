import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

// AI cost telemetry increment (2026-08-25). One row per feature, over
// whatever window the query was asked for (see AiUsageService.getSummary) —
// deliberately pre-aggregated server-side rather than handing back raw
// AiUsageEvent rows for the client to sum: nobody using this needs
// per-call granularity, and summing hundreds of rows client-side for a
// number that's always the same regardless of who computes it is wasted
// work better done once, in the one query that already has to scan them.
@ObjectType()
export class AiUsageByFeature {
  @Field()
  feature!: string;

  @Field(() => Int)
  callCount!: number;

  @Field(() => Int)
  inputTokens!: number;

  @Field(() => Int)
  outputTokens!: number;

  // Null exactly when every call in this bucket used a model not yet in
  // ai-pricing.ts's rate table — see that file's own comment for why this is
  // never silently coerced to 0 instead of staying an honest "unknown."
  @Field(() => Float, { nullable: true })
  estimatedCostUsd?: number;
}

@ObjectType()
export class AiUsageSummary {
  @Field(() => Int)
  windowDays!: number;

  @Field(() => Int)
  totalCalls!: number;

  @Field(() => Int)
  totalInputTokens!: number;

  @Field(() => Int)
  totalOutputTokens!: number;

  @Field(() => Float, { nullable: true })
  totalEstimatedCostUsd?: number;

  @Field(() => [AiUsageByFeature])
  byFeature!: AiUsageByFeature[];
}
