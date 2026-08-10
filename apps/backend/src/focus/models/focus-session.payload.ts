import { Field, ObjectType } from '@nestjs/graphql';
import { FocusSession } from './focus-session.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class StartFocusSessionPayload {
  @Field(() => FocusSession, { nullable: true })
  session?: FocusSession;

  @Field(() => [UserError])
  errors!: UserError[];
}

// Reused for both completeFocusSession and cancelFocusSession — same
// { session, errors } shape, same precedent as CompleteTaskPayload doing
// double duty for completeTask/cancelTask.
@ObjectType()
export class EndFocusSessionPayload {
  @Field(() => FocusSession, { nullable: true })
  session?: FocusSession;

  @Field(() => [UserError])
  errors!: UserError[];
}
