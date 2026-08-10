import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { HabitFrequency, MonthlyRecurrenceMode } from '../models/habit.model';

@InputType()
export class CreateHabitInput {
  @Field()
  @IsString()
  @Length(1, 200)
  title!: string;

  @Field(() => HabitFrequency)
  @IsIn([HabitFrequency.DAILY, HabitFrequency.WEEKLY, HabitFrequency.MONTHLY])
  frequency!: HabitFrequency;

  // Required (and validated as non-empty) by HabitsService.buildRruleOrThrow
  // when frequency is WEEKLY — cross-field validation like "required only
  // if X" is simpler to enforce in the service than with class-validator
  // decorators alone. Same reasoning applies to every other
  // frequency-conditional field below.
  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek?: number[];

  // Full custom habit recurrence increment. Defaults to 1 (plain daily/
  // weekly) in HabitsService.buildRruleOrThrow if omitted — only worth
  // setting above 1 for "every N days"/"every N weeks".
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  intervalDays?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  intervalWeeks?: number;

  @Field(() => MonthlyRecurrenceMode, { nullable: true })
  @IsOptional()
  @IsIn([
    MonthlyRecurrenceMode.DAY_OF_MONTH,
    MonthlyRecurrenceMode.NTH_WEEKDAY,
    MonthlyRecurrenceMode.DAYS_OF_MONTH,
    MonthlyRecurrenceMode.NTH_WEEKDAY_SET,
  ])
  monthlyMode?: MonthlyRecurrenceMode;

  // 1-31, or -1 for "the last day of the month" (real BYMONTHDAY
  // semantics — see rrule.ts's own comment on why day 31 simply has no
  // occurrence in a 30-day month, rather than being clamped to it).
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(-1)
  @Max(31)
  dayOfMonth?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  monthlyWeekday?: number;

  // 1-4 (first through fourth), or -1 for "the last".
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(-1)
  @Max(4)
  monthlyOrdinal?: number;

  // BYSETPOS / multiple weekdays per month increment: required (and
  // validated as at least 2 distinct entries) by
  // HabitsService.buildRruleOrThrow when monthlyMode is DAYS_OF_MONTH — same
  // cross-field-validation-belongs-in-the-service reasoning as every other
  // frequency/mode-conditional field above.
  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(31, { each: true })
  daysOfMonth?: number[];

  // Required (and validated as non-empty) when monthlyMode is
  // NTH_WEEKDAY_SET — the set monthlyOrdinal above counts through.
  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  monthlyWeekdaySet?: number[];

  // Fuller habit recurrence increment. Defaults to 1 (plain monthly) in
  // HabitsService.buildRruleOrThrow if omitted — same "only worth setting
  // above 1 for 'every N ___'" convention intervalDays/intervalWeeks above
  // already established. Capped lower than intervalDays/intervalWeeks
  // (24 months = 2 years) since a habit that recurs less often than that is
  // arguably not really a "habit" this app's own daily/weekly/monthly
  // planning surfaces are built around — a judgment call, not a hard
  // technical limit rrule.ts itself would need.
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  intervalMonths?: number;

  // Fuller habit recurrence increment: at most one of count/until is ever
  // set — HabitsService.buildRruleOrThrow throws INVALID_RECURRENCE if both
  // are (cross-field, so enforced there rather than with class-validator
  // decorators alone, same reasoning as every other conditional field
  // above). Recurs forever (today's existing behavior) when neither is set.
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  count?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'until must be a calendar date in YYYY-MM-DD format' })
  until?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'preferredTime must be in 24-hour HH:mm format' })
  preferredTime?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  protectedDurationMinutes?: number;

  // Linking habits to goals increment — same optional, unvalidated-against-
  // ownership shape as CreateTaskInput.goalId (Task's own goalId has never
  // checked that the goal actually belongs to the caller either; matching
  // that existing precedent here rather than introducing a stricter rule
  // for habits specifically).
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  goalId?: string;
}
