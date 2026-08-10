import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum CalendarEventSource {
  NATIVE = 'NATIVE',
  GOOGLE = 'GOOGLE',
  MICROSOFT = 'MICROSOFT',
  APPLE = 'APPLE',
}
registerEnumType(CalendarEventSource, { name: 'CalendarEventSource' });

// Mirrors calendar_events in the Database Design Document §4.3. This
// increment only ever produces NATIVE-sourced events — the enum's other
// three values exist so the sync increment is additive (a new resolver
// writing rows with a different `source`) rather than a schema change.
@ObjectType()
export class CalendarEvent {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  startTime!: Date;

  @Field()
  endTime!: Date;

  @Field()
  isImmovable!: boolean;

  @Field()
  isAiFocusBlock!: boolean;

  @Field(() => CalendarEventSource)
  source!: CalendarEventSource;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class CalendarEventEdge {
  @Field()
  cursor!: string;

  @Field(() => CalendarEvent)
  node!: CalendarEvent;
}
