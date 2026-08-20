import { Field, InputType } from '@nestjs/graphql';
import { IsString } from 'class-validator';

// Native app shell increment. Mirrors RegisterPushSubscriptionInput's own
// "match what the client already has in hand" shape — the Capacitor Push
// Notifications plugin's `registration` event hands the frontend a single
// opaque token string, so that's all this needs to carry.
@InputType()
export class RegisterNativePushTokenInput {
  @Field()
  @IsString()
  token!: string;

  @Field()
  @IsString()
  platform!: string;
}
