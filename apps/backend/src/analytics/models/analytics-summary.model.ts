import { Field, ID, Int, Float, ObjectType } from '@nestjs/graphql';
import { RoutineType } from '../../routines/models/routine.model';

// Life analytics / trend views increment (PRD §7.3) — the first increment
// that doesn't persist anything new at all: every field here is computed
// fresh, on read, from tables that already exist (mood_entries,
// energy_entries, sleep_entries, habit_logs, routine_logs). One point per
// local calendar day in the requested window, oldest first, so a chart's
// x-axis is always continuous — a day with no check-in logged is a real
// null, not omitted, not a fabricated zero.
@ObjectType()
export class DailyMoodEnergy {
  @Field()
  date!: string; // "YYYY-MM-DD", the user's own local calendar date

  @Field(() => Float, { nullable: true })
  averageMood?: number; // 1-5, averaged across that day's check-ins if more than one; null if none logged

  @Field(() => Float, { nullable: true })
  averageEnergy?: number;
}

@ObjectType()
export class DailySleep {
  @Field()
  date!: string;

  @Field(() => Int, { nullable: true })
  durationMinutes?: number;

  @Field(() => Int, { nullable: true })
  qualityScore?: number;
}

// Closes the README's long-standing "habit_logs already has everything
// needed to compute a streak, but no UI surfaces it yet" gap.
// `dueDaysInWindow`/`completedDaysInWindow` are exposed alongside the
// rolled-up percentage deliberately — "3 of 3" and "60 of 60" both round to
// a completion rate, but they're very different amounts of real evidence,
// and the raw counts let the frontend (or a person reading the API
// directly) tell them apart rather than trusting a lone percentage.
@ObjectType()
export class HabitStreak {
  @Field(() => ID)
  habitId!: string;

  @Field()
  title!: string;

  // Consecutive *due* days, most-recent-first, still unbroken as of today
  // (or as of the habit's most recent due day, if today isn't one) — a
  // non-due day never breaks a streak, only a due-but-not-completed one
  // does, same "only due days count" logic requestReplan already applies
  // when checking whether a habit's protected time exists at all.
  @Field(() => Int)
  currentStreak!: number;

  @Field(() => Int)
  dueDaysInWindow!: number;

  @Field(() => Int)
  completedDaysInWindow!: number;

  @Field(() => Int)
  completionRatePercent!: number;
}

// Closes the same gap the entry above does, for `routine_logs`. A routine
// (unlike a habit) is relevant every day once created — there's no rrule,
// no "due" concept — so this uses `daysInWindow` instead of
// `dueDaysInWindow`, otherwise the same shape.
@ObjectType()
export class RoutineConsistency {
  @Field(() => RoutineType)
  type!: RoutineType;

  @Field(() => Int)
  currentStreak!: number;

  @Field(() => Int)
  daysInWindow!: number;

  @Field(() => Int)
  completedDaysInWindow!: number;

  @Field(() => Int)
  completionRatePercent!: number;
}

// A same-window, day-paired Pearson correlation between two of the series
// above (e.g. sleep duration vs. mood) — computed fresh alongside them, not
// stored anywhere. Only days where *both* metrics in the pair have a real
// logged value (not the undefined/null placeholder) count toward
// `sampleSize`; a day missing either side is simply excluded from the pair,
// the same "exclude, don't fabricate" rule the daily series above already
// follow for a missing single value. Deliberately exploratory, not a
// scientific claim: `AnalyticsService` only surfaces a pair here at all once
// it clears both a minimum sample size and a minimum |coefficient|, so a
// thin or near-zero relationship never shows up as a false "insight."
@ObjectType()
export class MetricCorrelation {
  @Field()
  metricALabel!: string; // e.g. "Sleep duration"

  @Field()
  metricBLabel!: string; // e.g. "Mood"

  // 0 for a same-day comparison (the original version of this feature); 1,
  // 2, or 3 for a lagged comparison, where `metricALabel`'s value on day i
  // is paired with `metricBLabel`'s value on day i+lagDays ("does A predict
  // B this many days later") instead of both on the same day. There's no
  // separate "direction" field — the reverse relationship (does B predict A
  // later?) is just its own independent `MetricCorrelation` entry with
  // `metricALabel`/`metricBLabel` swapped, not a variant of this one; the
  // same underlying pair of metrics can appear up to seven times in total
  // (same-day once, plus both directions at each of the three lags) if
  // every one of those independently clears the minimum sample size/
  // strength bar — they're computed and reported completely independently
  // of each other.
  @Field(() => Int)
  lagDays!: number;

  @Field(() => Float)
  coefficient!: number; // Pearson's r, -1..1

  @Field(() => Int)
  sampleSize!: number; // number of day-pairs where both metrics had a real value

  @Field()
  description!: string; // plain-English summary, direction + strength + stats
}

// Insights: task/focus-session/journal trends increment — unlike
// DailyMoodEnergy/DailySleep above, a day here always gets a *real* zero,
// never `null`/undefined: a day where a person genuinely completed zero
// tasks is real, known information (not "we don't know"), the same way a
// day with zero due habits is different from a day nobody checked in. That
// distinction is why these three counts are plain non-nullable `Int`s
// rather than the `{ nullable: true }` pattern the check-in-based series
// use.
@ObjectType()
export class DailyTaskCompletion {
  @Field()
  date!: string;

  @Field(() => Int)
  completedCount!: number;
}

// Real elapsed minutes (`endedAt - startedAt`), not the merely *planned*
// duration — a session someone ended early or let run long should count for
// what actually happened, not what was scheduled. Only COMPLETED sessions
// count at all; a cancelled one contributes to neither field, same "only
// the genuine finished signal counts" rule the focus-session auto-replan
// trigger already applies to this exact same underlying data.
@ObjectType()
export class DailyFocusMinutes {
  @Field()
  date!: string;

  @Field(() => Int)
  completedMinutes!: number;

  @Field(() => Int)
  completedSessions!: number;
}

// A streak/consistency view over the same focus-session data as
// DailyFocusMinutes above, shaped like RoutineConsistency (a single
// entity, not one row per habit/routine-type) — "focus sessions" has no
// per-item breakdown the way habits or routine types do, so this is one
// summary, not an array. `daysInWindow` is always the full window size
// (there's no "not created yet" clamp the way a habit or routine needs,
// since focus sessions aren't tied to when something was set up).
@ObjectType()
export class FocusSessionConsistency {
  @Field(() => Int)
  currentStreak!: number;

  @Field(() => Int)
  daysInWindow!: number;

  @Field(() => Int)
  completedDaysInWindow!: number;

  @Field(() => Int)
  completionRatePercent!: number;
}

// Same real-zero-not-null reasoning as DailyTaskCompletion above — a day
// with zero journal entries is known, not missing.
@ObjectType()
export class DailyJournalActivity {
  @Field()
  date!: string;

  @Field(() => Int)
  entryCount!: number;
}

@ObjectType()
export class AnalyticsSummary {
  @Field(() => Int)
  windowDays!: number;

  @Field(() => [DailyMoodEnergy])
  dailyMoodEnergy!: DailyMoodEnergy[];

  @Field(() => [DailySleep])
  dailySleep!: DailySleep[];

  @Field(() => [HabitStreak])
  habitStreaks!: HabitStreak[];

  @Field(() => [RoutineConsistency])
  routineConsistency!: RoutineConsistency[];

  @Field(() => [MetricCorrelation])
  correlations!: MetricCorrelation[];

  @Field(() => [DailyTaskCompletion])
  dailyTaskCompletions!: DailyTaskCompletion[];

  @Field(() => [DailyFocusMinutes])
  dailyFocusMinutes!: DailyFocusMinutes[];

  @Field(() => FocusSessionConsistency)
  focusSessionConsistency!: FocusSessionConsistency;

  @Field(() => [DailyJournalActivity])
  dailyJournalActivity!: DailyJournalActivity[];
}
