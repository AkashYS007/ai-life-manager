import { Field, InputType, Int } from '@nestjs/graphql';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, Length } from 'class-validator';
import { Chronotype } from '../models/user.model';

// Same 24h "HH:mm" convention/regex as CompleteOnboardingInput and
// UpdateNotificationPreferencesInput (quiet hours) — duplicated here rather
// than shared, the same small-well-understood-constant judgment call this
// project already makes a few times elsewhere (see e.g. toUtcDateOnly in
// analytics.service.ts).
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

@InputType()
export class UpdateProfileInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  displayName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  timezone?: string;

  // Visible settings screen increment — set to `true` alongside `timezone`
  // when a person explicitly saves one from /settings (so TimezoneSync
  // stops silently overriding it), or back to `false` via Settings' "use
  // browser-detected automatically" action. Omitted entirely by
  // TimezoneSync's own silent write, which only ever sends `timezone`, not
  // this — undefined here follows the same "leave this column alone when
  // not sent" convention every other optional field on this input already
  // does.
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  timezoneManual?: boolean;

  @Field(() => Chronotype, { nullable: true })
  @IsOptional()
  @IsIn(Object.values(Chronotype))
  chronotype?: Chronotype;

  // Visible settings screen increment — closes the "work hours can only
  // ever be set once, during onboarding" gap; same HH:mm validation
  // CompleteOnboardingInput's own workHoursStart/End already use.
  @Field({ nullable: true })
  @IsOptional()
  @Matches(HH_MM, { message: 'workHoursStart must be in 24-hour HH:mm format' })
  workHoursStart?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(HH_MM, { message: 'workHoursEnd must be in 24-hour HH:mm format' })
  workHoursEnd?: string;

  // Configurable Pomodoro durations increment — closes "Pomodoro mode's
  // cadence is fixed" from the README's own "not built yet" list. Same
  // "null/omitted falls back to the fixed default" convention
  // workHoursStart/End already use — sent as `null` from Settings' own
  // "Reset to defaults" action, omitted (left alone) by every mutation call
  // that isn't this one. Bounds are sanity limits, not a product decision —
  // nothing in the PRD specifies a Pomodoro max/min, but an unbounded
  // "work block" invites garbage input more than it serves a real use case
  // (same reasoning StartFocusSessionInput's own 180-minute ceiling
  // documents).
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  pomodoroWorkMinutes?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  pomodoroShortBreakMinutes?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  pomodoroLongBreakMinutes?: number;

  // 2-12: fewer than 2 work blocks between long breaks isn't really "long
  // break every Nth cycle" anymore, and 12 is already a very long stretch
  // of uninterrupted Pomodoro cycling in one sitting.
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(12)
  pomodoroCyclesBeforeLongBreak?: number;

  // Configurable reminder windows/thresholds increment — closes "Reminder
  // windows and thresholds are fixed, not configurable" from the README's
  // own "not built yet" list. Same "null/omitted falls back to the fixed
  // default" convention every other nullable field on this input already
  // uses. Hours are whole-hour local time (0-23), matching
  // SchedulerService's own 30-minute catch-window precision — not
  // minute-precise like workHoursStart/End, since a reminder firing
  // sometime in a 30-minute window was never minute-precise to begin with.
  // min/max overdue bounds are sanity limits (same reasoning
  // pomodoroWorkMinutes' own bounds document) — cross-field ordering
  // (min < max) is checked in the resolver, not here, matching
  // createCalendarEvent/updateCalendarEvent's own existing
  // startTime/endTime cross-field check, since class-validator's per-field
  // decorators can't compare two sibling fields against each other.
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  reminderMorningRoutineHour?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  reminderEveningRoutineHour?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  reminderReflectionHour?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  reminderHabitMinOverdueMinutes?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  reminderHabitMaxOverdueMinutes?: number;

  // Configurable daily reflection questions increment — same "null/omitted
  // falls back to the fixed default" convention as every other nullable
  // field on this input. These rename what's *displayed* for each of the
  // three fixed reflection questions; they don't add a fourth question or
  // change what's actually stored on a submitted DailyReflection (still
  // always `{wentWell, challenging, carryForward}` — see this same
  // reasoning in schema.prisma's own comment on these three columns).
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 150)
  reflectionWentWellLabel?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 150)
  reflectionChallengingLabel?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 150)
  reflectionCarryForwardLabel?: string;
}
