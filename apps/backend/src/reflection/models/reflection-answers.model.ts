import { Field, ObjectType } from '@nestjs/graphql';

// Shapes the `answers` JSONB column (Database Design Document §5.1) into a
// real GraphQL type rather than a raw JSON scalar — same precedent as
// AiPlanRun.diff/PlanDiff. The three fixed questions this increment asks
// (PRD §7.3's "end-of-day 3-question ritual") — not configurable per user
// yet, see README.
@ObjectType()
export class ReflectionAnswers {
  @Field()
  wentWell!: string;

  @Field()
  challenging!: string;

  @Field()
  carryForward!: string;
}
