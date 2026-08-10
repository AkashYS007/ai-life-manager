import { Field, ID, ObjectType } from '@nestjs/graphql';
import { AiMemoryFact } from './memory-fact.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class CreateMemoryFactPayload {
  @Field(() => AiMemoryFact, { nullable: true })
  fact?: AiMemoryFact;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class UpdateMemoryFactPayload {
  @Field(() => AiMemoryFact, { nullable: true })
  fact?: AiMemoryFact;

  @Field(() => [UserError])
  errors!: UserError[];
}

// Never a bare boolean (API Design Document §3) — `deletedFactId` lets a
// client evict exactly one item from its Apollo cache without a refetch,
// same convention as DeleteCalendarEventPayload.
@ObjectType()
export class DeleteMemoryFactPayload {
  @Field(() => ID, { nullable: true })
  deletedFactId?: string;

  @Field(() => [UserError])
  errors!: UserError[];
}
