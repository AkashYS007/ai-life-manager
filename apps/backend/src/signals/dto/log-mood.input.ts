import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

@InputType()
export class LogMoodInput {
  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(5)
  moodScore!: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}
