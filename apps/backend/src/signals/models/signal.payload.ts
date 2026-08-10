import { Field, ObjectType } from '@nestjs/graphql';
import { MoodEntry } from './mood-entry.model';
import { EnergyEntry } from './energy-entry.model';
import { SleepEntry } from './sleep-entry.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class LogMoodPayload {
  @Field(() => MoodEntry, { nullable: true })
  moodEntry?: MoodEntry;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class LogEnergyPayload {
  @Field(() => EnergyEntry, { nullable: true })
  energyEntry?: EnergyEntry;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class LogSleepPayload {
  @Field(() => SleepEntry, { nullable: true })
  sleepEntry?: SleepEntry;

  @Field(() => [UserError])
  errors!: UserError[];
}
