import { Field, InputType } from '@nestjs/graphql';
import { IsDate, IsString } from 'class-validator';
import { Type } from 'class-transformer';

// Free-form plan editing increment: lets a person add a task the AI didn't
// propose at all into a plan they're about to accept, alongside the
// existing PlanChangeEditInput (move/remove a change the AI *did* propose).
// Unlike an edit, there's no existing PlanChange.id to reference — this
// input identifies the task directly instead. Only meaningful when
// decision === EDIT, same as `edits` (see PlannerResolver.respondToPlanRun
// and PlannerService.respondToPlanRun's EDIT branch, which now processes
// `adds` right after it finishes applying `edits`).
@InputType()
export class PlanChangeAddInput {
  // Must be one of the caller's own open tasks — re-validated server-side
  // against a fresh `tasksService.listByIds` lookup, not trusted just
  // because the client sent an id (same "never trust client-asserted
  // ownership" discipline every other userId-scoped lookup in this codebase
  // already follows).
  @Field()
  @IsString()
  taskId!: string;

  // A specific time, not "sometime this week" — this is a person placing a
  // task on the plan themselves, so there's no AI proposal to interpret;
  // unlike PlanChangeEditInput.proposedStart this one is required, since an
  // add with no time at all has nothing to validate or apply.
  @Field()
  @Type(() => Date)
  @IsDate()
  proposedStart!: Date;
}
