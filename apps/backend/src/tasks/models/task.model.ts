import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { Goal } from './goal.model';
import { Tag } from './tag.model';

export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}
registerEnumType(TaskStatus, { name: 'TaskStatus' });

// Mirrors Task in the API Design Document §4.3. `subtasks` and `tags` are
// resolved by the service layer (flattened from the task_tags join table)
// rather than needing separate GraphQL field resolvers — see
// tasks.service.ts's `toGraphTask` mapper.
@ObjectType()
export class Task {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Goal, { nullable: true })
  goal?: Goal;

  @Field(() => ID, { nullable: true })
  parentTaskId?: string;

  @Field(() => [Task])
  subtasks!: Task[];

  @Field(() => Int)
  priority!: number;

  @Field(() => TaskStatus)
  status!: TaskStatus;

  @Field(() => Int, { nullable: true })
  estimatedDurationMinutes?: number;

  @Field(() => Int, { nullable: true })
  actualDurationMinutes?: number;

  @Field({ nullable: true })
  dueDate?: Date;

  @Field({ nullable: true })
  scheduledStart?: Date;

  @Field({ nullable: true })
  scheduledEnd?: Date;

  @Field()
  isAiScheduled!: boolean;

  @Field(() => [Tag])
  tags!: Tag[];

  @Field()
  createdAt!: Date;

  @Field({ nullable: true })
  completedAt?: Date;
}

@ObjectType()
export class TaskEdge {
  @Field()
  cursor!: string;

  @Field(() => Task)
  node!: Task;
}
