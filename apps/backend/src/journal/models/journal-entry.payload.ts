import { Field, ObjectType } from '@nestjs/graphql';
import { JournalEntry } from './journal-entry.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class CreateJournalEntryPayload {
  @Field(() => JournalEntry, { nullable: true })
  entry?: JournalEntry;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class UpdateJournalEntryPayload {
  @Field(() => JournalEntry, { nullable: true })
  entry?: JournalEntry;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class DeleteJournalEntryPayload {
  @Field({ nullable: true })
  deletedEntryId?: string;

  @Field(() => [UserError])
  errors!: UserError[];
}
