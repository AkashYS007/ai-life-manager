import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { HabitFrequency, MonthlyRecurrenceMode } from '../models/habit.model';

// Partial update, same convention as UpdateTaskInput/UpdateCalendarEventInput
// — every field optional, only what's provided gets changed. `active` is
// deliberately not here: that's deactivateHabit's job (API Design Document
// §6.2), not a generic field flip.
@InputType()
export class UpdateHabitInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @Field(() => HabitFrequency, { nullable: true })
  @IsOptional()
  @IsIn([HabitFrequency.DAILY, HabitFrequency.WEEKLY, HabitFrequency.MONTHLY])
  frequency?: HabitFrequency;

  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek?: number[];

  // Full custom habit recurrence increment — same fields as
  // CreateHabitInput; HabitsService.update falls back to the habit's
  // existing recurrence for whatever isn't provided here.
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

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(-1)
  @Max(4)
  monthlyOrdinal?: number;

  // BYSETPOS / multiple weekdays per month increment — same fields as
  // CreateHabitInput.
  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(31, { each: true })
  daysOfMonth?: number[];

  @Field(() => [Int], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  monthlyWeekdaySet?: number[];

  // Fuller habit recurrence increment — same fields as CreateHabitInput.
  // `count`/`until` here can also be sent as an explicit `null` to clear an
  // existing end condition back to "recurs forever" (see HabitsService.
  // update's own comment on the resulting three-way undefined/null/value
  // handling) — the same explicit-null-clears convention goalId already
  // established below.
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  intervalMonths?: number;

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

  // Habit-edit UI increment: closes the "a habit's goal link can only be
  // set once, at creation" gap named throughout the README — same
  // optional, unvalidated-against-ownership shape as CreateHabitInput's own
  // goalId (see that field's comment), and the same "omitted leaves it
  // alone, explicit null clears it" behavior UpdateTaskInput.goalId already
  // gives Tasks — HabitsService.update passes this straight through to
  // Prisma, which treats `undefined` as "don't touch" and `null` as "clear
  // the relation."
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  goalId?: string;
}
