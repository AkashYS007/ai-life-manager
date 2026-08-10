import { Field, ObjectType } from '@nestjs/graphql';
import { Notification } from './notification.model';
import { User } from '../../users/models/user.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class MarkNotificationReadPayload {
  @Field(() => Notification, { nullable: true })
  notification?: Notification;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class UpdateNotificationPreferencesPayload {
  @Field(() => User, { nullable: true })
  user?: User;

  @Field(() => [UserError])
  errors!: UserError[];
}
