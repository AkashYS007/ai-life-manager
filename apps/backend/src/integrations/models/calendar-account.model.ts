import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum CalendarAccountProvider {
  GOOGLE = 'GOOGLE',
  MICROSOFT = 'MICROSOFT',
  APPLE = 'APPLE',
}
registerEnumType(CalendarAccountProvider, { name: 'CalendarAccountProvider' });

export enum CalendarAccountStatus {
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR',
  REVOKED = 'REVOKED',
}
registerEnumType(CalendarAccountStatus, { name: 'CalendarAccountStatus' });

// Mirrors calendar_accounts (Database Design Document §4.3) — deliberately
// never exposes the encrypted token columns; there is no legitimate client
// use case for them, encrypted or not.
@ObjectType()
export class CalendarAccount {
  @Field(() => ID)
  id!: string;

  @Field(() => CalendarAccountProvider)
  provider!: CalendarAccountProvider;

  @Field({ nullable: true })
  externalAccountEmail?: string;

  @Field(() => CalendarAccountStatus)
  status!: CalendarAccountStatus;

  @Field({ nullable: true })
  lastSyncedAt?: Date;

  // Real-time calendar updates (webhooks) increment — true when this
  // account has a currently-live Google channel / Microsoft Graph
  // subscription registered (computed in IntegrationsResolver from
  // webhookExpiresAt, never a raw stored column itself). Nullable rather
  // than a plain Boolean since APPLE accounts never get one computed at all
  // (CalDAV has no webhook mechanism this app implements — see the
  // README) — `null` there, not `false`, is the honest "not applicable"
  // reading of that fact for that specific provider.
  @Field({ nullable: true })
  realtimeSyncEnabled?: boolean;

  @Field()
  createdAt!: Date;
}
