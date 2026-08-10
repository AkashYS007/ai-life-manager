import { Field, ObjectType } from '@nestjs/graphql';
import { User } from './user.model';
import { UserError } from '../../common/errors/user-error.model';

// Every mutation payload follows this shape (API Design Document §3): the
// resource or null, plus a never-null errors array — so adding a field later
// is always a non-breaking schema change.
@ObjectType()
export class UpdateProfilePayload {
  @Field(() => User, { nullable: true })
  user?: User;

  @Field(() => [UserError])
  errors!: UserError[];
}
