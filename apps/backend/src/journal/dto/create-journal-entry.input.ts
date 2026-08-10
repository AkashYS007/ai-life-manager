import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType()
export class CreateJournalEntryInput {
  // 20,000 chars is a generous sanity bound (a very long multi-page entry),
  // not a product decision — the PRD doesn't specify a max, an unbounded
  // TEXT column just invites accidental pasted-garbage-sized input.
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content!: string;
}
