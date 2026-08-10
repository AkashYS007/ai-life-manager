import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum RoutineType {
  MORNING = 'MORNING',
  EVENING = 'EVENING',
}
registerEnumType(RoutineType, { name: 'RoutineType' });

@ObjectType()
export class RoutineStep {
  @Field(() => ID)
  id!: string;

  @Field()
  label!: string;
}

// Mirrors `routines` (Database Design Document §5.1) plus today's
// completion state layered on top (see RoutineLog in schema.prisma — a
// gap in the approved doc, designed fresh). `steps` is returned in display
// order: the stored template order normally, or the AI's suggested
// reordering when `aiSequenced` is true and Anthropic is configured (see
// RoutinesService.getTodayFor) — either way this field is always a safe,
// validated permutation of the same steps, never a different set.
@ObjectType()
export class Routine {
  @Field(() => ID)
  id!: string;

  @Field(() => RoutineType)
  type!: RoutineType;

  @Field(() => [RoutineStep])
  steps!: RoutineStep[];

  @Field()
  aiSequenced!: boolean;

  @Field(() => [ID])
  completedStepIds!: string[];

  @Field()
  updatedAt!: Date;
}
