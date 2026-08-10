import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsDate, IsOptional, IsString, Length } from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class UpdateCalendarEventInput {
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
  startTime?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endTime?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isImmovable?: boolean;
}
