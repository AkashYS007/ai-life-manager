import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// The three fixed end-of-day questions (PRD §7.3) — see README for why
// these aren't user-configurable yet.
@InputType()
export class SubmitDailyReflectionInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  wentWell!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  challenging!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  carryForward!: string;
}
