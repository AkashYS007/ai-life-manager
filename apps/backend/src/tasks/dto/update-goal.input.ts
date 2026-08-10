import { Field, InputType } from '@nestjs/graphql';
import { IsDate, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Type } from 'class-transformer';
import { GoalStatus } from '../models/goal.model';

@InputType()
export class UpdateGoalInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  targetDate?: Date;

  @Field(() => GoalStatus, { nullable: true })
  @IsOptional()
  @IsIn(Object.values(GoalStatus))
  status?: GoalStatus;
}
