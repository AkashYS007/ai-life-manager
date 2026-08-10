import { Field, ObjectType } from '@nestjs/graphql';
import { Habit } from './habit.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class CreateHabitPayload {
  @Field(() => Habit, { nullable: true })
  habit?: Habit;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class UpdateHabitPayload {
  @Field(() => Habit, { nullable: true })
  habit?: Habit;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class DeactivateHabitPayload {
  @Field(() => Habit, { nullable: true })
  habit?: Habit;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class CompleteHabitLogPayload {
  @Field(() => Habit, { nullable: true })
  habit?: Habit;

  @Field(() => [UserError])
  errors!: UserError[];
}
