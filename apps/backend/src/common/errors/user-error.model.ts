import { Field, ObjectType } from '@nestjs/graphql';

// Matches UserError in the API Design Document §4.1 — expected, user-facing
// failures travel inside a mutation payload's `errors` field (HTTP 200),
// never as a thrown exception. Thrown GraphQLErrors are reserved for
// authorization failures and genuinely unexpected system errors (§9).
@ObjectType()
export class UserError {
  @Field({ nullable: true })
  field?: string;

  @Field()
  code!: string;

  @Field()
  message!: string;
}
