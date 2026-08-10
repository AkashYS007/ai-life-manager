import { Field, InputType, Int } from '@nestjs/graphql';
import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class LogSleepInput {
  // Defaults to today (in the user's timezone) when omitted — see
  // signals.service.ts. Explicit so a "log last night" flow done just
  // after midnight can still attribute sleep to the right morning.
  @Field({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  sleepDate?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  bedtime?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  wakeTime?: Date;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationMinutes?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  qualityScore?: number;
}
