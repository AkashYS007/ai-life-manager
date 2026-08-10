import { Field, ID, ObjectType } from '@nestjs/graphql';
import { CalendarEvent } from './calendar-event.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class CreateCalendarEventPayload {
  @Field(() => CalendarEvent, { nullable: true })
  event?: CalendarEvent;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class UpdateCalendarEventPayload {
  @Field(() => CalendarEvent, { nullable: true })
  event?: CalendarEvent;

  @Field(() => [UserError])
  errors!: UserError[];
}

// Never a bare boolean (API Design Document §3) — `deletedEventId` lets a
// client evict exactly one item from its Apollo cache without a refetch.
@ObjectType()
export class DeleteCalendarEventPayload {
  @Field(() => ID, { nullable: true })
  deletedEventId?: string;

  @Field(() => [UserError])
  errors!: UserError[];
}
