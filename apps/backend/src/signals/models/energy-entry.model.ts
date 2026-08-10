import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum EnergySource {
  MANUAL = 'MANUAL',
  INFERRED = 'INFERRED',
}
registerEnumType(EnergySource, { name: 'EnergySource' });

// Mirrors energy_entries (Database Design Document §4.5). Every entry this
// increment writes has source=MANUAL — INFERRED (from sleep/calendar load,
// PRD §7.2) is a P1 the enum already leaves room for.
@ObjectType()
export class EnergyEntry {
  @Field(() => ID)
  id!: string;

  @Field()
  loggedAt!: Date;

  @Field(() => Int)
  energyScore!: number;

  @Field(() => EnergySource)
  source!: EnergySource;
}
