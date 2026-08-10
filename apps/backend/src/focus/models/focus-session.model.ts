import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum FocusSessionStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}
registerEnumType(FocusSessionStatus, { name: 'FocusSessionStatus' });

// Automatic Pomodoro work/break cycling increment — see schema.prisma's
// FocusSessionKind comment for the full reasoning. Defaults to WORK.
export enum FocusSessionKind {
  WORK = 'WORK',
  BREAK = 'BREAK',
}
registerEnumType(FocusSessionKind, { name: 'FocusSessionKind' });

// Mirrors the new focus_sessions table (see schema.prisma for why this
// domain isn't in the approved Database Design Document). taskId/taskTitle
// are flattened onto the session itself (same shaping FocusService does,
// same reasoning TasksService.toGraphTask flattens tags) rather than
// exposing a full nested Task field — a focus session only ever needs to
// show which task it's for, not the task's full detail, and this avoids a
// separate field resolver for a one-line label.
@ObjectType()
export class FocusSession {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { nullable: true })
  taskId?: string;

  @Field({ nullable: true })
  taskTitle?: string;

  @Field(() => Int)
  plannedDurationMinutes!: number;

  @Field(() => FocusSessionKind)
  kind!: FocusSessionKind;

  @Field()
  startedAt!: Date;

  @Field({ nullable: true })
  endedAt?: Date;

  @Field(() => FocusSessionStatus)
  status!: FocusSessionStatus;
}
