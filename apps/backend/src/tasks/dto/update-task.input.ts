import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TaskStatus } from '../models/task.model';

@InputType()
export class UpdateTaskInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  goalId?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  priority?: number;

  @Field(() => TaskStatus, { nullable: true })
  @IsOptional()
  @IsIn(Object.values(TaskStatus))
  status?: TaskStatus;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedDurationMinutes?: number;

  @Field({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @Field(() => [ID], { nullable: true })
  @IsOptional()
  @IsUUID('all', { each: true })
  tagIds?: string[];
}
