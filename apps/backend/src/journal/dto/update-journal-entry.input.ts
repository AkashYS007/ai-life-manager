import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType()
export class UpdateJournalEntryInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content!: string;
}
