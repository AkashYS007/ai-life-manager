import { Field, ObjectType } from '@nestjs/graphql';
import { Task } from './task.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class CreateTaskPayload {
  @Field(() => Task, { nullable: true })
  task?: Task;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class UpdateTaskPayload {
  @Field(() => Task, { nullable: true })
  task?: Task;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class CompleteTaskPayload {
  @Field(() => Task, { nullable: true })
  task?: Task;

  @Field(() => [UserError])
  errors!: UserError[];
}
