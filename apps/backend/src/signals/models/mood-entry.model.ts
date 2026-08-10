import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

// Mirrors mood_entries (Database Design Document §4.5). Deliberately no
// `userId` field exposed — every other model in this codebase follows the
// same rule (see Task, CalendarEvent): ownership is an internal scoping
// concern, never something a client needs to read back.
@ObjectType()
export class MoodEntry {
  @Field(() => ID)
  id!: string;

  @Field()
  loggedAt!: Date;

  @Field(() => Int)
  moodScore!: number;

  @Field({ nullable: true })
  note?: string;
}
