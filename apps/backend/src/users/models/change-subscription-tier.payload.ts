import { Field, ObjectType } from '@nestjs/graphql';
import { User } from './user.model';
import { UserError } from '../../common/errors/user-error.model';

// Same shape every mutation payload in this codebase follows (API Design
// Document §3) — the resource or null, plus a never-null errors array.
// Returns the whole `User` (not just the `Subscription`) so the frontend
// can read the updated `subscription` straight off the mutation result
// without a separate refetch, same as `UpdateProfilePayload`.
@ObjectType()
export class ChangeSubscriptionTierPayload {
  @Field(() => User, { nullable: true })
  user?: User;

  @Field(() => [UserError])
  errors!: UserError[];
}
