import { Field, ObjectType } from '@nestjs/graphql';
import { Routine } from './routine.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class SetRoutinePayload {
  @Field(() => Routine, { nullable: true })
  routine?: Routine;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class SetTodayRoutineCompletionPayload {
  @Field(() => Routine, { nullable: true })
  routine?: Routine;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class DeleteRoutinePayload {
  @Field()
  deleted!: boolean;

  @Field(() => [UserError])
  errors!: UserError[];
}
