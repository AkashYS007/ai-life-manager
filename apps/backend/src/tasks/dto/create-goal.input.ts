import { Field, InputType } from '@nestjs/graphql';
import { IsDate, IsOptional, IsString, Length } from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class CreateGoalInput {
  @Field()
  @IsString()
  @Length(1, 200)
  title!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  targetDate?: Date;
}
