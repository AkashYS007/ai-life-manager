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

@ObjectType()
export class SendTestNotificationPayload {
  // Distinguishes "we had a subscription and attempted a real send" from
  // "there was nothing registered for this account at all" — the latter
  // means the person needs to tap "Turn on browser notifications" again on
  // *this* device, not that anything is broken server-side.
  @Field()
  sent!: boolean;

  @Field()
  subscriptionCount!: number;

  @Field(() => [UserError])
  errors!: UserError[];
}
