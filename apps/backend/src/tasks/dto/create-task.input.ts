import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { IsDate, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class CreateTaskInput {
  @Field()
  @IsString()
  @Length(1, 200)
  title!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  goalId?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  parentTaskId?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  priority?: number;

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
