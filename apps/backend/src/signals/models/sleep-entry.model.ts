import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum SleepSource {
  MANUAL = 'MANUAL',
  HEALTHKIT = 'HEALTHKIT',
  HEALTH_CONNECT = 'HEALTH_CONNECT',
  OURA = 'OURA',
  WHOOP = 'WHOOP',
}
registerEnumType(SleepSource, { name: 'SleepSource' });

// Mirrors sleep_entries (Database Design Document §4.5). Every entry this
// increment writes has source=MANUAL — wearable sync (PRD §7.2, P1) is
// reserved in the enum, not built yet.
@ObjectType()
export class SleepEntry {
  @Field(() => ID)
  id!: string;

  @Field()
  sleepDate!: Date;

  @Field({ nullable: true })
  bedtime?: Date;

  @Field({ nullable: true })
  wakeTime?: Date;

  @Field(() => Int, { nullable: true })
  durationMinutes?: number;

  @Field(() => Int, { nullable: true })
  qualityScore?: number;

  @Field(() => SleepSource)
  source!: SleepSource;
}
