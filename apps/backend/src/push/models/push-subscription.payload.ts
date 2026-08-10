import { Field, ObjectType } from '@nestjs/graphql';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class RegisterPushSubscriptionPayload {
  @Field()
  registered!: boolean;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class UnregisterPushSubscriptionPayload {
  @Field()
  unregistered!: boolean;

  @Field(() => [UserError])
  errors!: UserError[];
}
