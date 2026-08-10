import { Field, ObjectType } from '@nestjs/graphql';
import { Goal } from './goal.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class CreateGoalPayload {
  @Field(() => Goal, { nullable: true })
  goal?: Goal;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class UpdateGoalPayload {
  @Field(() => Goal, { nullable: true })
  goal?: Goal;

  @Field(() => [UserError])
  errors!: UserError[];
}
