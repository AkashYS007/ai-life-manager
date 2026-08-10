import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum GoalStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  ABANDONED = 'ABANDONED',
}
registerEnumType(GoalStatus, { name: 'GoalStatus' });

// Mirrors goals in the Database Design Document §4.2.
@ObjectType()
export class Goal {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  targetDate?: Date;

  @Field(() => GoalStatus)
  status!: GoalStatus;

  @Field()
  createdAt!: Date;

  // Goal progress view increment: "3 of 5 done" — `taskCount` deliberately
  // excludes CANCELLED tasks (a cancelled task was never really "supposed
  // to happen," matching how the Tasks screen's own Open/Cancelled split
  // already treats cancelled work as set apart from the real backlog, not
  // counted against it), while `completedTaskCount` only counts a real
  // COMPLETED status. Both are computed fresh by GoalsService on every
  // read — no new column, no persisted denormalized count to keep in sync.
  @Field(() => Int)
  taskCount!: number;

  @Field(() => Int)
  completedTaskCount!: number;

  // Linking habits to goals increment. Deliberately not merged into
  // taskCount/completedTaskCount above — a habit is a recurring thing with
  // no terminal "done" state a task has, so "3 of 5 done" framing doesn't
  // apply to it the same way; this is a plain count of how many active
  // habits point at this goal, shown as its own line, not folded into the
  // task progress bar's math.
  @Field(() => Int)
  linkedHabitCount!: number;
}
