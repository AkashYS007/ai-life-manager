import { Field, InputType } from '@nestjs/graphql';
import { IsString, Length } from 'class-validator';

@InputType()
export class MemoryFactInput {
  @Field()
  @IsString()
  @Length(1, 500)
  content!: string;
}
