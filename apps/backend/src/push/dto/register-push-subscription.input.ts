import { Field, InputType } from '@nestjs/graphql';
import { IsString } from 'class-validator';

// Real notification delivery increment. Mirrors exactly what a browser's
// `PushSubscription.toJSON()` returns — `endpoint` plus the `p256dh`/`auth`
// keys under `.keys` — so the frontend can send the object almost as-is
// (see PushSubscribe.tsx).
@InputType()
export class RegisterPushSubscriptionInput {
  @Field()
  @IsString()
  endpoint!: string;

  @Field()
  @IsString()
  p256dh!: string;

  @Field()
  @IsString()
  auth!: string;
}
