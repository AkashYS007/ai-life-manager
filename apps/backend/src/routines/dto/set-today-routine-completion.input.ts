import { Field, InputType } from '@nestjs/graphql';
import { IsIn, IsString } from 'class-validator';
import { RoutineType } from '../models/routine.model';

// Sends the *whole* set of completed step ids for today, not a single
// toggle delta — simpler client and server (no +/- array surgery to keep
// in sync), matching the "replace whole state" precedent HabitRow's
// tap-to-toggle checkbox does *not* use (a habit log toggles one row), but
// which fits better here since a routine's steps are a single JSON blob,
// not individually addressable rows the way HabitLog's are.
@InputType()
export class SetTodayRoutineCompletionInput {
  // Bug fix: same missing-class-validator-decorator issue SetRoutineInput's
  // own `type` field had (see that file's comment for the full mechanism —
  // the app's global `ValidationPipe({ whitelist: true })` silently strips
  // any input property with no class-validator decorator at all). This
  // field had the identical gap, meaning `setTodayRoutineCompletion` would
  // have failed with the same "Argument `type` is missing" Prisma error
  // the moment anyone actually exercised it against a real server.
  @Field(() => RoutineType)
  @IsIn([RoutineType.MORNING, RoutineType.EVENING])
  type!: RoutineType;

  @Field(() => [String])
  @IsString({ each: true })
  completedStepIds!: string[];
}
