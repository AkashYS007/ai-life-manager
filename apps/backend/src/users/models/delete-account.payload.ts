import { Field, ObjectType } from '@nestjs/graphql';
import { UserError } from '../../common/errors/user-error.model';

// Account deletion increment. Same shape as DeleteRoutinePayload/
// DeleteJournalEntryPayload's own precedent — a plain `deleted` boolean, not
// the returned-resource-or-null shape UpdateProfilePayload uses, since
// there's no User left to return once this succeeds.
@ObjectType()
export class DeleteAccountPayload {
  @Field()
  deleted!: boolean;

  @Field(() => [UserError])
  errors!: UserError[];
}
