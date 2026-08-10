import { Field, InputType } from '@nestjs/graphql';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsIn, IsString } from 'class-validator';
import { RoutineType } from '../models/routine.model';

@InputType()
export class SetRoutineInput {
  // Bug fix: this field had only the GraphQL `@Field` decorator, no
  // class-validator decorator — the app's global `ValidationPipe({
  // whitelist: true })` (main.ts) strips any input property with no
  // class-validator decorator on it at all, so `type` was silently dropped
  // from every setRoutine call before it ever reached the resolver,
  // regardless of what the client actually sent, producing a Prisma
  // "Argument `type` is missing" error. Every other enum-typed input field
  // in this codebase already pairs its `@Field` with `@IsIn([...])` (see
  // CreateHabitInput.frequency) — this one had just been missed.
  @Field(() => RoutineType)
  @IsIn([RoutineType.MORNING, RoutineType.EVENING])
  type!: RoutineType;

  // Plain labels in — a fresh stable id is generated for each step
  // server-side (see RoutinesService.setRoutine). Full-replace semantics:
  // editing a routine's steps resets the whole checklist rather than
  // diffing against the previous one, the simplest correct behavior for
  // "variable per user, edited rarely" content.
  @Field(() => [String])
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  steps!: string[];

  @Field()
  @IsBoolean()
  aiSequenced!: boolean;
}
