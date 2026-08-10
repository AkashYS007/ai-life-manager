import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum RecommendationCategory {
  BREAK = 'BREAK',
  WORKOUT = 'WORKOUT',
  MEAL = 'MEAL',
}
registerEnumType(RecommendationCategory, { name: 'RecommendationCategory' });

@ObjectType()
export class Recommendation {
  @Field(() => ID)
  id!: string;

  @Field(() => RecommendationCategory)
  category!: RecommendationCategory;

  @Field()
  message!: string;

  @Field()
  dismissed!: boolean;
}

// Mirrors ai_recommendation_runs (Database Design Document gap — see
// schema.prisma's comment above the table). One of these exists per user
// per day at most; `recommendations` is always the AI's most recent
// generation for today, dismiss state layered on top per-item (see
// RecommendationsService.dismiss).
@ObjectType()
export class AiRecommendationRun {
  @Field(() => ID)
  id!: string;

  @Field()
  date!: Date;

  @Field(() => [Recommendation])
  recommendations!: Recommendation[];

  @Field({ nullable: true })
  modelUsed?: string;

  @Field()
  generatedAt!: Date;
}
