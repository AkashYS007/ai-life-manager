import { Field, ObjectType } from '@nestjs/graphql';

// Relay Cursor Connections primitive (API Design Document §3/§4.1) — shared
// by every paginated list field in the schema.
@ObjectType()
export class PageInfo {
  @Field()
  hasNextPage!: boolean;

  @Field()
  hasPreviousPage!: boolean;

  @Field({ nullable: true })
  startCursor?: string;

  @Field({ nullable: true })
  endCursor?: string;
}
