import { Field, ID, ObjectType } from '@nestjs/graphql';

// Mirrors AiMemoryFact in the Database Design Document §4.6, flattened for
// the "manual memory first" scope of this increment — the client only ever
// sees `content` (the storage layer's `value.text`), never `factType`/`key`
// (both always fixed values this increment: 'preference' and a
// server-generated id) or the raw JSONB shape. Same "service layer hides
// storage details" split as everywhere else in this codebase.
@ObjectType()
export class AiMemoryFact {
  @Field(() => ID)
  id!: string;

  @Field()
  content!: string;

  @Field()
  confidence!: number;

  @Field()
  updatedAt!: Date;
}
