import { Field, ObjectType } from '@nestjs/graphql';
import { User } from '../../users/models/user.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class CompleteOnboardingPayload {
  @Field(() => User, { nullable: true })
  user?: User;

  @Field(() => [UserError])
  errors!: UserError[];
}
