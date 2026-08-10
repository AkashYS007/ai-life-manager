import { Field, ID, ObjectType } from '@nestjs/graphql';

// Mirrors `notifications` (Database Design Document §4.7) with the JSONB
// `payload` flattened into real fields (title/body/deeplink) — same
// "service layer shapes the response, GraphQL model never sees the storage
// representation" split as PlanDiff/ReflectionAnswers/RoutineStep. `channel`,
// `status`, and the raw `scheduledFor` aren't exposed at all: nothing in
// this app's UI needs to distinguish PUSH/EMAIL/SMS (only PUSH is ever
// really used — see NotificationsService) or PENDING/SENT (a notification
// only ever shows up here once it's due — see listRecent), and `read` is
// the one derived bit of state the UI actually needs, computed from
// `readAt`.
@ObjectType()
export class Notification {
  @Field(() => ID)
  id!: string;

  @Field()
  type!: string;

  @Field()
  title!: string;

  @Field()
  body!: string;

  @Field()
  deeplink!: string;

  @Field()
  read!: boolean;

  @Field()
  createdAt!: Date;
}
