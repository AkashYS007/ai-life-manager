import { Field, ObjectType } from '@nestjs/graphql';
import { CalendarEventEdge } from './calendar-event.model';
import { PageInfo } from '../../common/graphql/page-info.model';

// Relay-style connection (API Design Document §3) for the root-level
// `calendarEvents` query — a dedicated Calendar view paging back through
// history. The Today screen uses `calendarEventsInRange` instead, since a
// single day's events are naturally bounded and don't need cursor paging.
@ObjectType()
export class CalendarEventConnection {
  @Field(() => [CalendarEventEdge])
  edges!: CalendarEventEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;
}
