import { Field, ID, ObjectType } from '@nestjs/graphql';
import { ReflectionAnswers } from './reflection-answers.model';

// Mirrors daily_reflections (Database Design Document §5.1). `aiSummary` is
// nullable — populated by a real Claude call at submit time when
// ANTHROPIC_API_KEY is configured (see reflection.service.ts), left null
// otherwise, same honest-degradation pattern the AI daily planner and chat
// already use for a missing key.
@ObjectType()
export class DailyReflection {
  @Field(() => ID)
  id!: string;

  @Field()
  date!: Date;

  @Field(() => ReflectionAnswers)
  answers!: ReflectionAnswers;

  @Field({ nullable: true })
  aiSummary?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}
