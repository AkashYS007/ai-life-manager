import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, Length } from 'class-validator';

@InputType()
export class CreateTagInput {
  @Field()
  @IsString()
  @Length(1, 40)
  name!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  color?: string;
}
