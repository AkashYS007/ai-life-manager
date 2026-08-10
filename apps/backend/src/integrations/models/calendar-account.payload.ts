import { Field, Int, ObjectType } from '@nestjs/graphql';
import { CalendarAccount } from './calendar-account.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class StartGoogleCalendarConnectionPayload {
  @Field({ nullable: true })
  authUrl?: string;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class DisconnectCalendarAccountPayload {
  @Field()
  disconnected!: boolean;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class SyncGoogleCalendarPayload {
  @Field(() => CalendarAccount, { nullable: true })
  account?: CalendarAccount;

  @Field(() => Int, { nullable: true })
  syncedEventCount?: number;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class StartMicrosoftCalendarConnectionPayload {
  @Field({ nullable: true })
  authUrl?: string;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class SyncMicrosoftCalendarPayload {
  @Field(() => CalendarAccount, { nullable: true })
  account?: CalendarAccount;

  @Field(() => Int, { nullable: true })
  syncedEventCount?: number;

  @Field(() => [UserError])
  errors!: UserError[];
}

// Apple's "connect" is a direct username+password submission, not an OAuth
// redirect, so there's no StartAppleCalendarConnectionPayload/authUrl the
// way Google/Microsoft have — connecting and getting the resulting account
// back happen in the same mutation response.
@ObjectType()
export class ConnectAppleCalendarPayload {
  @Field(() => CalendarAccount, { nullable: true })
  account?: CalendarAccount;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class SyncAppleCalendarPayload {
  @Field(() => CalendarAccount, { nullable: true })
  account?: CalendarAccount;

  @Field(() => Int, { nullable: true })
  syncedEventCount?: number;

  @Field(() => [UserError])
  errors!: UserError[];
}
