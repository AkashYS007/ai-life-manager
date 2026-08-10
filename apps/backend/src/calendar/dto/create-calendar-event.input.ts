import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsDate, IsOptional, IsString, Length } from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class CreateCalendarEventInput {
  @Field()
  @IsString()
  @Length(1, 200)
  title!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field()
  @Type(() => Date)
  @IsDate()
  startTime!: Date;

  @Field()
  @Type(() => Date)
  @IsDate()
  endTime!: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isImmovable?: boolean;
}
