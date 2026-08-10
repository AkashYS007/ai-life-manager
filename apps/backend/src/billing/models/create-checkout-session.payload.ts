import { Field, ObjectType } from '@nestjs/graphql';
import { UserError } from '../../common/errors/user-error.model';

// Mirrors StartGoogleCalendarConnectionPayload's own shape exactly
// (`authUrl` there, `checkoutUrl` here) — the frontend does the same
// `window.location.href = payload.checkoutUrl` full-browser-navigation
// pattern GoogleCalendarConnect.tsx already established for handing off to
// a third party's own hosted flow.
@ObjectType()
export class CreateCheckoutSessionPayload {
  @Field({ nullable: true })
  checkoutUrl?: string;

  @Field(() => [UserError])
  errors!: UserError[];
}
