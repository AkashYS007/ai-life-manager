import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { Goal } from '../../tasks/models/goal.model';

export enum HabitFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  // Full custom habit recurrence increment.
  MONTHLY = 'MONTHLY',
}
registerEnumType(HabitFrequency, { name: 'HabitFrequency' });

// Only meaningful when frequency is MONTHLY — which pair of fields below
// (dayOfMonth, or monthlyWeekday+monthlyOrdinal) actually describes the
// pattern. Kept as its own enum rather than inferring it from which fields
// are set, so a client always knows which UI to show without guessing.
export enum MonthlyRecurrenceMode {
  DAY_OF_MONTH = 'DAY_OF_MONTH',
  NTH_WEEKDAY = 'NTH_WEEKDAY',
  // BYSETPOS / multiple weekdays per month increment.
  DAYS_OF_MONTH = 'DAYS_OF_MONTH',
  NTH_WEEKDAY_SET = 'NTH_WEEKDAY_SET',
}
registerEnumType(MonthlyRecurrenceMode, { name: 'MonthlyRecurrenceMode' });

// Mirrors Habit in the Database Design Document §4.4. The client never sees
// the raw `rrule` string — these fields are the parsed, editable shape
// (HabitsService hydrates them from rrule.ts's parseRrule), same "service
// layer shapes the response" split as Task's tags/subtasks.
// `todayCompleted` is always computed against *today* (the caller's local
// calendar day), whether this Habit came from the `habits` management query
// or TodayPlan.habits.
@ObjectType()
export class Habit {
  @Field(() => ID)
  id!: string;

  @Field()
  title!: string;

  @Field(() => HabitFrequency)
  frequency!: HabitFrequency;

  // ISO weekday numbers, 1 (Monday) through 7 (Sunday) — only meaningful
  // when frequency is WEEKLY.
  @Field(() => [Int], { nullable: true })
  daysOfWeek?: number[];

  // Full custom habit recurrence increment: "every N days"/"every N weeks"
  // — only meaningful (and only ever > 1) when frequency is DAILY/WEEKLY
  // respectively. A plain daily or weekly-on-these-days habit still has
  // these as 1, not null, so a client can always show "every N ___"
  // without a separate "is this even an interval habit" check.
  @Field(() => Int, { nullable: true })
  intervalDays?: number;

  @Field(() => Int, { nullable: true })
  intervalWeeks?: number;

  // Only meaningful when frequency is MONTHLY.
  @Field(() => MonthlyRecurrenceMode, { nullable: true })
  monthlyMode?: MonthlyRecurrenceMode;

  // 1-31, or -1 for "the last day of the month" — only meaningful when
  // frequency is MONTHLY and monthlyMode is DAY_OF_MONTH.
  @Field(() => Int, { nullable: true })
  dayOfMonth?: number;

  // ISO weekday 1-7 — only meaningful when frequency is MONTHLY and
  // monthlyMode is NTH_WEEKDAY.
  @Field(() => Int, { nullable: true })
  monthlyWeekday?: number;

  // 1-4 (first through fourth), or -1 for "the last" — only meaningful
  // alongside monthlyWeekday (mode NTH_WEEKDAY) or monthlyWeekdaySet (mode
  // NTH_WEEKDAY_SET, see below).
  @Field(() => Int, { nullable: true })
  monthlyOrdinal?: number;

  // BYSETPOS / multiple weekdays per month increment: several specific
  // days of the month in one rule ("the 1st and 15th") — only meaningful
  // when frequency is MONTHLY and monthlyMode is DAYS_OF_MONTH. Always at
  // least 2 entries when present (a single day belongs to dayOfMonth/
  // DAY_OF_MONTH above instead — see rrule.ts's own comment on why).
  @Field(() => [Int], { nullable: true })
  daysOfMonth?: number[];

  // ISO weekdays 1-7, the set "the Nth (or last) day among these weekdays"
  // (monthlyOrdinal above) counts through — only meaningful when frequency
  // is MONTHLY and monthlyMode is NTH_WEEKDAY_SET. Genuinely different from
  // monthlyWeekday (a single specific weekday) — e.g. weekdaySet [1..5]
  // (Mon-Fri) with monthlyOrdinal -1 is "the last weekday of the month,"
  // whichever weekday that turns out to be, not "the last Friday."
  @Field(() => [Int], { nullable: true })
  monthlyWeekdaySet?: number[];

  // Fuller habit recurrence increment: "every N months" — only meaningful
  // (and only ever > 1) when frequency is MONTHLY, same "always present as
  // 1, not null, for a plain monthly habit" convention intervalDays/
  // intervalWeeks above already established.
  @Field(() => Int, { nullable: true })
  intervalMonths?: number;

  // Fuller habit recurrence increment: a habit recurs forever until
  // deactivated unless one of these two is set — at most one ever is (see
  // rrule.ts's own buildRrule, which throws if both are given). `count` is
  // "recur this many times total, from creation, then stop" (a real
  // occurrence count, not a completion count — see HabitsService's own
  // comment on why). `until` is a plain calendar date ("YYYY-MM-DD"),
  // inclusive of that day, same "a plain date string, not a DateTime
  // scalar" treatment preferredTime already gets above.
  @Field(() => Int, { nullable: true })
  count?: number;

  @Field({ nullable: true })
  until?: string;

  // "HH:mm" 24-hour local time, or null if the habit has no preferred time.
  @Field({ nullable: true })
  preferredTime?: string;

  @Field(() => Int)
  protectedDurationMinutes!: number;

  @Field()
  active!: boolean;

  @Field()
  todayCompleted!: boolean;

  // Linking habits to goals increment. Same optional-relation shape as
  // Task.goal — set at creation only, since there's no habit edit UI at
  // all yet (goalId included).
  @Field(() => Goal, { nullable: true })
  goal?: Goal;
}
