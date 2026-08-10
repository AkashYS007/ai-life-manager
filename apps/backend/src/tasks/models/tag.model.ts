import { Field, ID, ObjectType } from '@nestjs/graphql';

// Mirrors tags in the Database Design Document §5 (secondary domain tables).
@ObjectType()
export class Tag {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  color?: string;
}
