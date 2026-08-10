import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { SignalsService } from '../signals/signals.service';
import { HabitsService } from '../habits/habits.service';
import { RoutinesService } from '../routines/routines.service';
import { TasksService } from '../tasks/tasks.service';
import { FocusService } from '../focus/focus.service';
import { JournalService } from '../journal/journal.service';
import { isDueOn } from '../habits/rrule';
import { RoutineType } from '../routines/models/routine.model';
import {
  AnalyticsSummary,
  DailyFocusMinutes,
  DailyJournalActivity,
  DailyMoodEnergy,
  DailySleep,
  DailyTaskCompletion,
  FocusSessionConsistency,
  HabitStreak,
  MetricCorrelation,
  RoutineConsistency,
} from './models/analytics-summary.model';

const DEFAULT_WINDOW_DAYS = 30;
const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;

// A correlation below this many paired days isn't reported at all — too
// thin a sample to say anything meaningful, even if the coefficient looks
// large (a handful of days can easily produce a big-looking r by chance).
const MIN_CORRELATION_SAMPLE_SIZE = 5;
// A correlation weaker than this (in either direction) isn't reported
// either — a near-zero r isn't a real "insight," it's noise dressed up as
// one. 0.3 is a deliberately loose bar (this is a personal-reflection tool,
// not a research paper), chosen to surface plausible patterns without
// pretending they're proven.
const MIN_CORRELATION_ABS_R = 0.3;

// Renders a local calendar date as the UTC-midnight-anchored `Date` shape
// every `@db.Date` column in this project (sleep_entries.sleep_date,
// habit_logs.scheduled_date, routine_logs.scheduled_date) expects — the
// exact same helper, by another name, that signals.service.ts, habits
// .service.ts, and routines.service.ts each already define for themselves.
// Not reused directly from any of them (each is private to its own file);
// duplicated here rather than extracted into a shared module, the same
// "small, well-understood helper, not worth a new shared file for three
// call sites" judgment call already made a few times elsewhere in this
// codebase.
function toUtcDateOnly(isoDate: string): Date {
  return new Date(isoDate);
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly signalsService: SignalsService,
    private readonly habitsService: HabitsService,
    private readonly routinesService: RoutinesService,
    private readonly tasksService: TasksService,
    private readonly focusService: FocusService,
    private readonly journalService: JournalService,
  ) {}

  async getSummary(userId: string, timezone: string, days?: number): Promise<AnalyticsSummary> {
    const windowDays = Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, days ?? DEFAULT_WINDOW_DAYS));
    const todayLocal = DateTime.now().setZone(timezone).startOf('day');
    const windowStartLocal = todayLocal.minus({ days: windowDays - 1 });

    // The backbone every per-day series below is built against — one entry
    // per local calendar day in the window, oldest first, so every
    // returned series always has exactly `windowDays` points regardless of
    // how much real data exists.
    const dates: DateTime[] = [];
    for (let i = 0; i < windowDays; i++) {
      dates.push(windowStartLocal.plus({ days: i }));
    }

    const [moodEntries, energyEntries, sleepEntries] = await Promise.all([
      this.signalsService.getMoodEntriesInRange(userId, windowStartLocal.toJSDate()),
      this.signalsService.getEnergyEntriesInRange(userId, windowStartLocal.toJSDate()),
      this.signalsService.getSleepEntriesInRange(userId, toUtcDateOnly(windowStartLocal.toISODate()!)),
    ]);

    const dailyMoodEnergy: DailyMoodEnergy[] = dates.map((d) => {
      const dateStr = d.toISODate()!;
      const moodScoresForDay = moodEntries
        .filter((e) => DateTime.fromJSDate(e.loggedAt, { zone: timezone }).toISODate() === dateStr)
        .map((e) => e.moodScore);
      const energyScoresForDay = energyEntries
        .filter((e) => DateTime.fromJSDate(e.loggedAt, { zone: timezone }).toISODate() === dateStr)
        .map((e) => e.energyScore);
      return {
        date: dateStr,
        averageMood: moodScoresForDay.length ? round1(average(moodScoresForDay)) : undefined,
        averageEnergy: energyScoresForDay.length ? round1(average(energyScoresForDay)) : undefined,
      };
    });

    // sleep_entries.sleep_date is UTC-midnight-anchored regardless of the
    // user's real timezone (see signals.service.ts's own toDateOnly) — keyed
    // here in 'UTC' specifically to match that anchoring, not the user's zone.
    const sleepByDate = new Map(
      sleepEntries.map((e) => [DateTime.fromJSDate(e.sleepDate as unknown as Date, { zone: 'UTC' }).toISODate(), e]),
    );
    const dailySleep: DailySleep[] = dates.map((d) => {
      const dateStr = d.toISODate()!;
      const entry = sleepByDate.get(dateStr);
      return {
        date: dateStr,
        durationMinutes: entry?.durationMinutes ?? undefined,
        qualityScore: entry?.qualityScore ?? undefined,
      };
    });

    const windowStartDateOnly = toUtcDateOnly(windowStartLocal.toISODate()!);
    const todayDateOnly = toUtcDateOnly(todayLocal.toISODate()!);

    // Insights: task/focus-session/journal trends increment — real
    // timestamp bounds (not the UTC-date-only anchors above, which only
    // ever suit the habit_logs/routine_logs `@db.Date` columns), spanning
    // midnight on the window's first local day through the end of today.
    const [completedTasks, completedFocusSessions, journalEntries] = await Promise.all([
      this.tasksService.listCompletedInRange(userId, windowStartLocal.toJSDate(), todayLocal.endOf('day').toJSDate()),
      this.focusService.listCompletedInRange(userId, windowStartLocal.toJSDate(), todayLocal.endOf('day').toJSDate()),
      this.journalService.listCreatedInRange(userId, windowStartLocal.toJSDate(), todayLocal.endOf('day').toJSDate()),
    ]);

    // Unlike dailyMoodEnergy/dailySleep, every entry here is a real,
    // known zero on a day nothing happened — never `undefined` — see the
    // comment on DailyTaskCompletion for why that distinction matters.
    const dailyTaskCompletions: DailyTaskCompletion[] = dates.map((d) => {
      const dateStr = d.toISODate()!;
      const completedCount = completedTasks.filter(
        (t) => DateTime.fromJSDate(t.completedAt, { zone: timezone }).toISODate() === dateStr,
      ).length;
      return { date: dateStr, completedCount };
    });

    const dailyFocusMinutes: DailyFocusMinutes[] = dates.map((d) => {
      const dateStr = d.toISODate()!;
      const sessionsForDay = completedFocusSessions.filter(
        (s) => DateTime.fromJSDate(s.startedAt, { zone: timezone }).toISODate() === dateStr,
      );
      const completedMinutes = sessionsForDay.reduce(
        (sum, s) => sum + Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000),
        0,
      );
      return { date: dateStr, completedMinutes, completedSessions: sessionsForDay.length };
    });

    // A focus-session "streak," same walk-from-the-end shape as the habit/
    // routine streaks above, but over a single synthetic day-result series
    // (was at least one session completed that day?) rather than per-item —
    // see FocusSessionConsistency's own comment for why this is one summary,
    // not an array.
    let focusDaysInWindow = 0;
    let focusCompletedDaysInWindow = 0;
    const focusDayResults: boolean[] = [];
    for (const day of dailyFocusMinutes) {
      focusDaysInWindow++;
      const wasActive = day.completedSessions > 0;
      if (wasActive) focusCompletedDaysInWindow++;
      focusDayResults.push(wasActive);
    }
    let focusCurrentStreak = 0;
    for (let i = focusDayResults.length - 1; i >= 0; i--) {
      if (!focusDayResults[i]) break;
      focusCurrentStreak++;
    }
    const focusSessionConsistency: FocusSessionConsistency = {
      currentStreak: focusCurrentStreak,
      daysInWindow: focusDaysInWindow,
      completedDaysInWindow: focusCompletedDaysInWindow,
      completionRatePercent:
        focusDaysInWindow > 0 ? Math.round((focusCompletedDaysInWindow / focusDaysInWindow) * 100) : 0,
    };

    const dailyJournalActivity: DailyJournalActivity[] = dates.map((d) => {
      const dateStr = d.toISODate()!;
      const entryCount = journalEntries.filter(
        (e) => DateTime.fromJSDate(e.createdAt, { zone: timezone }).toISODate() === dateStr,
      ).length;
      return { date: dateStr, entryCount };
    });

    // Habits
    const habits = await this.habitsService.listRawForAnalytics(userId);
    const habitLogs = await this.habitsService.getLogsInRange(
      habits.map((h) => h.id),
      windowStartDateOnly,
      todayDateOnly,
    );
    const habitLogsByHabit = new Map<string, typeof habitLogs>();
    for (const log of habitLogs) {
      const list = habitLogsByHabit.get(log.habitId) ?? [];
      list.push(log);
      habitLogsByHabit.set(log.habitId, list);
    }

    // Per-day due/completed counts across *all* habits combined, indexed to
    // `dates` (not the per-habit `dueDayResults` below, which skips
    // non-due/not-yet-created days and so isn't index-aligned across
    // habits) — this is what lets "habit completion" become a single daily
    // series comparable to mood/energy for the correlation pass further
    // down, the same way dailyMoodEnergy/dailySleep already are.
    const dueCountByDayIndex = new Array(dates.length).fill(0);
    const completedCountByDayIndex = new Array(dates.length).fill(0);

    const habitStreaks: HabitStreak[] = habits.map((habit) => {
      const createdLocal = DateTime.fromJSDate(habit.createdAt, { zone: timezone }).startOf('day');
      const logs = habitLogsByHabit.get(habit.id) ?? [];
      const completedDateSet = new Set(
        logs
          .filter((l) => !!l.completedAt)
          .map((l) => DateTime.fromJSDate(l.scheduledDate as unknown as Date, { zone: 'UTC' }).toISODate()),
      );

      let dueDaysInWindow = 0;
      let completedDaysInWindow = 0;
      // Only *due* days go in here, oldest first — a non-due day is simply
      // never added, so it can never break the streak walk below, the same
      // "only due days count" reasoning requestReplan already applies when
      // deciding whether a habit occupies protected time on a given day.
      const dueDayResults: boolean[] = [];
      for (let i = 0; i < dates.length; i++) {
        const d = dates[i];
        if (d < createdLocal) continue; // the habit didn't exist yet
        // Full custom habit recurrence increment: `createdLocal` doubles as
        // the anchor interval-based patterns ("every N days"/"every N
        // weeks") count from — see rrule.ts's own comment on why. Every
        // other pattern (interval 1, or MONTHLY) simply ignores it.
        if (!isDueOn(habit.rrule, d, createdLocal)) continue;
        dueDaysInWindow++;
        const wasCompleted = completedDateSet.has(d.toISODate()!);
        if (wasCompleted) completedDaysInWindow++;
        dueDayResults.push(wasCompleted);
        dueCountByDayIndex[i]++;
        if (wasCompleted) completedCountByDayIndex[i]++;
      }

      let currentStreak = 0;
      for (let i = dueDayResults.length - 1; i >= 0; i--) {
        if (!dueDayResults[i]) break;
        currentStreak++;
      }

      return {
        habitId: habit.id,
        title: habit.title,
        currentStreak,
        dueDaysInWindow,
        completedDaysInWindow,
        completionRatePercent: dueDaysInWindow > 0 ? Math.round((completedDaysInWindow / dueDaysInWindow) * 100) : 0,
      };
    });

    // Routines
    const routines = await this.routinesService.listRawForAnalytics(userId);
    const routineLogs = await this.routinesService.getLogsInRange(
      routines.map((r) => r.id),
      windowStartDateOnly,
      todayDateOnly,
    );
    const routineLogsByRoutine = new Map<string, typeof routineLogs>();
    for (const log of routineLogs) {
      const list = routineLogsByRoutine.get(log.routineId) ?? [];
      list.push(log);
      routineLogsByRoutine.set(log.routineId, list);
    }

    const routineConsistency: RoutineConsistency[] = [];
    for (const routine of routines) {
      // A step's total count comes from the routine's *current* checklist,
      // not whatever it was on any given historical day (SetRoutineInput's
      // full-replace semantics mean there's no per-day snapshot of what the
      // checklist even looked like then) — a known, deliberate
      // approximation, most visible right after someone changes their
      // checklist's length (see README). An empty current checklist can't
      // meaningfully be judged "done" at all, so it's skipped entirely
      // rather than reporting a misleading 100%/0%.
      const totalSteps = (routine.checklist as unknown as unknown[]).length;
      if (totalSteps === 0) continue;

      const createdLocal = DateTime.fromJSDate(routine.createdAt, { zone: timezone }).startOf('day');
      const logs = routineLogsByRoutine.get(routine.id) ?? [];
      const completedByDate = new Map(
        logs.map((l) => [
          DateTime.fromJSDate(l.scheduledDate as unknown as Date, { zone: 'UTC' }).toISODate(),
          ((l.completedStepIds as unknown as string[]) ?? []).length >= totalSteps,
        ]),
      );

      let daysInWindow = 0;
      let completedDaysInWindow = 0;
      const dayResults: boolean[] = [];
      for (const d of dates) {
        if (d < createdLocal) continue;
        daysInWindow++;
        const wasCompleted = completedByDate.get(d.toISODate()!) ?? false;
        if (wasCompleted) completedDaysInWindow++;
        dayResults.push(wasCompleted);
      }

      let currentStreak = 0;
      for (let i = dayResults.length - 1; i >= 0; i--) {
        if (!dayResults[i]) break;
        currentStreak++;
      }

      routineConsistency.push({
        type: routine.type as RoutineType,
        currentStreak,
        daysInWindow,
        completedDaysInWindow,
        completionRatePercent: daysInWindow > 0 ? Math.round((completedDaysInWindow / daysInWindow) * 100) : 0,
      });
    }

    // Habit completion as a single daily series (0-100, undefined on a day
    // with nothing due at all — "nothing was due" is not the same claim as
    // "0% completed," so it's excluded rather than reported as a fabricated
    // zero, same rule as every other daily series in this file).
    const dailyHabitCompletionRate: (number | undefined)[] = dates.map((_, i) =>
      dueCountByDayIndex[i] > 0 ? (completedCountByDayIndex[i] / dueCountByDayIndex[i]) * 100 : undefined,
    );

    const moodSeries = dailyMoodEnergy.map((d) => d.averageMood);
    const energySeries = dailyMoodEnergy.map((d) => d.averageEnergy);
    const sleepDurationSeries = dailySleep.map((d) => d.durationMinutes);
    const sleepQualitySeries = dailySleep.map((d) => d.qualityScore);
    // Wiring Insights' newest trends into correlation increment — these
    // three are always real numbers, never `undefined` (see the comment on
    // DailyTaskCompletion et al.: a day with zero activity is a known
    // zero, not a missing check-in), so every day in the window
    // legitimately participates in these pairs, unlike sleep/habit
    // completion where a day can genuinely have nothing to compare.
    const taskCompletionSeries = dailyTaskCompletions.map((d) => d.completedCount as number | undefined);
    const focusMinutesSeries = dailyFocusMinutes.map((d) => d.completedMinutes as number | undefined);
    const journalEntriesSeries = dailyJournalActivity.map((d) => d.entryCount as number | undefined);

    // Every base pair worth checking given what's already aggregated above.
    // Sleep quality/duration, habit completion, tasks completed, focused
    // minutes, and journal entries are each checked against both mood and
    // energy; mood-vs-energy itself is deliberately left out (they're both
    // self-reported same-moment check-ins, not two independent signals —
    // correlating them would mostly just measure how correlated a single
    // check-in's two sliders tend to be).
    //
    // Correlating non-mood/energy metrics increment: the same six metrics
    // are now also checked directly against *each other* — does sleep
    // predict habit completion, does focused time predict task completion,
    // and so on — not just each one's relationship to mood/energy. One
    // exclusion carried over from the same reasoning as mood-vs-energy
    // above: sleep duration vs. sleep quality is deliberately left out too,
    // since both come from the same `SleepEntry` row for the same night —
    // the same "same-moment measurement, not two independent signals"
    // judgment call, not an oversight.
    const basePairs: Array<{
      labelA: string;
      seriesA: (number | undefined)[];
      labelB: string;
      seriesB: (number | undefined)[];
    }> = [
      { labelA: 'Sleep duration', seriesA: sleepDurationSeries, labelB: 'Mood', seriesB: moodSeries },
      { labelA: 'Sleep duration', seriesA: sleepDurationSeries, labelB: 'Energy', seriesB: energySeries },
      { labelA: 'Sleep quality', seriesA: sleepQualitySeries, labelB: 'Mood', seriesB: moodSeries },
      { labelA: 'Sleep quality', seriesA: sleepQualitySeries, labelB: 'Energy', seriesB: energySeries },
      { labelA: 'Habit completion', seriesA: dailyHabitCompletionRate, labelB: 'Mood', seriesB: moodSeries },
      { labelA: 'Habit completion', seriesA: dailyHabitCompletionRate, labelB: 'Energy', seriesB: energySeries },
      { labelA: 'Tasks completed', seriesA: taskCompletionSeries, labelB: 'Mood', seriesB: moodSeries },
      { labelA: 'Tasks completed', seriesA: taskCompletionSeries, labelB: 'Energy', seriesB: energySeries },
      { labelA: 'Focused minutes', seriesA: focusMinutesSeries, labelB: 'Mood', seriesB: moodSeries },
      { labelA: 'Focused minutes', seriesA: focusMinutesSeries, labelB: 'Energy', seriesB: energySeries },
      { labelA: 'Journal entries', seriesA: journalEntriesSeries, labelB: 'Mood', seriesB: moodSeries },
      { labelA: 'Journal entries', seriesA: journalEntriesSeries, labelB: 'Energy', seriesB: energySeries },
      // Non-mood/energy pairs — 14 of them: every one of the six metrics
      // above against every other, except sleep-duration-vs-sleep-quality
      // (see the comment above).
      { labelA: 'Sleep duration', seriesA: sleepDurationSeries, labelB: 'Habit completion', seriesB: dailyHabitCompletionRate },
      { labelA: 'Sleep duration', seriesA: sleepDurationSeries, labelB: 'Tasks completed', seriesB: taskCompletionSeries },
      { labelA: 'Sleep duration', seriesA: sleepDurationSeries, labelB: 'Focused minutes', seriesB: focusMinutesSeries },
      { labelA: 'Sleep duration', seriesA: sleepDurationSeries, labelB: 'Journal entries', seriesB: journalEntriesSeries },
      { labelA: 'Sleep quality', seriesA: sleepQualitySeries, labelB: 'Habit completion', seriesB: dailyHabitCompletionRate },
      { labelA: 'Sleep quality', seriesA: sleepQualitySeries, labelB: 'Tasks completed', seriesB: taskCompletionSeries },
      { labelA: 'Sleep quality', seriesA: sleepQualitySeries, labelB: 'Focused minutes', seriesB: focusMinutesSeries },
      { labelA: 'Sleep quality', seriesA: sleepQualitySeries, labelB: 'Journal entries', seriesB: journalEntriesSeries },
      { labelA: 'Habit completion', seriesA: dailyHabitCompletionRate, labelB: 'Tasks completed', seriesB: taskCompletionSeries },
      { labelA: 'Habit completion', seriesA: dailyHabitCompletionRate, labelB: 'Focused minutes', seriesB: focusMinutesSeries },
      { labelA: 'Habit completion', seriesA: dailyHabitCompletionRate, labelB: 'Journal entries', seriesB: journalEntriesSeries },
      { labelA: 'Tasks completed', seriesA: taskCompletionSeries, labelB: 'Focused minutes', seriesB: focusMinutesSeries },
      { labelA: 'Tasks completed', seriesA: taskCompletionSeries, labelB: 'Journal entries', seriesB: journalEntriesSeries },
      { labelA: 'Focused minutes', seriesA: focusMinutesSeries, labelB: 'Journal entries', seriesB: journalEntriesSeries },
    ];

    // Multi-day / reverse-direction lag increment: each base pair is now
    // checked at same-day (lagDays: 0, unchanged) plus a one-, two-, and
    // three-day lag — "does two nights ago's sleep predict today's mood,"
    // not just yesterday's. `MIN_CORRELATION_SAMPLE_SIZE` already handles
    // the natural ceiling this creates on its own: at the minimum 7-day
    // window, a 3-day lag only leaves 4 paired days, one short of the
    // reporting bar, so it's silently excluded there rather than needing
    // any special-casing — the same gate that already existed, just doing
    // a bit more work now that there's a longer lag to shrink the sample.
    //
    // Every lag beyond same-day is now checked in *both* directions, not
    // just A-leading-B — the Lagged correlation increment's own "What's not
    // built yet" entry named this gap directly ("does today's mood predict
    // tomorrow's sleep?" was never asked, only the reverse). Reverse
    // direction needed zero new fields on `MetricCorrelation`: it's
    // computed by handing `evaluatePair` the exact same two series with A
    // and B swapped, so the resulting entry naturally reports
    // `metricALabel`/`metricBLabel` swapped too, and reads correctly
    // through the existing `describeCorrelation` sentence with no change
    // to it beyond the wording generalization below (e.g. "Higher mood
    // tends to come with lower sleep duration the next day" is a real,
    // independently-labeled entry, not a reinterpretation of the forward
    // one sitting next to it). Only checked for `lagDays > 0` — at
    // `lagDays: 0` a same-day Pearson coefficient is exactly symmetric
    // (corr(A, B) === corr(B, A)), so checking the reverse there would
    // only ever produce an exact duplicate of the forward same-day entry
    // under swapped labels, never new information.
    const LAG_DAYS_OPTIONS = [0, 1, 2, 3];

    const correlations: MetricCorrelation[] = [];
    for (const pair of basePairs) {
      for (const lagDays of LAG_DAYS_OPTIONS) {
        const forward = evaluatePair(pair.labelA, pair.seriesA, pair.labelB, pair.seriesB, lagDays);
        if (forward) correlations.push(forward);

        if (lagDays > 0) {
          const reverse = evaluatePair(pair.labelB, pair.seriesB, pair.labelA, pair.seriesA, lagDays);
          if (reverse) correlations.push(reverse);
        }
      }
    }
    // Strongest relationship first — this is the order the frontend renders
    // them in, and there's no other natural ordering (they're different
    // units, so sorting by raw coefficient value rather than magnitude
    // would bury a strong negative correlation at the bottom). A same-day
    // and a one-day-lag result for the same pair sort independently of
    // each other, purely on their own strength.
    correlations.sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));

    // Correlating non-mood/energy metrics increment: 26 base pairs × 7
    // candidate checks each (182 total) is a real jump from before this
    // increment, and unlike the previous 12 base pairs, several of these
    // new ones are plausible to *all* qualify together on genuinely busy or
    // genuinely slow real days (tasks completed, focused minutes, and
    // journal entries realistically move together for mundane reasons — a
    // full day is a full day). A silent cap on how many strongest entries
    // are actually returned, same "small, well-understood constant" call
    // this file already makes for the sample-size/strength bars above —
    // keeps "Patterns worth noting" from turning into an overwhelming wall
    // of near-identical sentences on an account with a lot of real,
    // genuinely correlated activity. Still sorted strongest-first, so
    // trimming the list never hides a stronger relationship in favor of a
    // weaker one.
    const MAX_CORRELATIONS_RETURNED = 15;
    const trimmedCorrelations = correlations.slice(0, MAX_CORRELATIONS_RETURNED);

    return {
      windowDays,
      dailyMoodEnergy,
      dailySleep,
      habitStreaks,
      routineConsistency,
      correlations: trimmedCorrelations,
      dailyTaskCompletions,
      dailyFocusMinutes,
      focusSessionConsistency,
      dailyJournalActivity,
    };
  }
}

function average(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// A real Pearson correlation coefficient over whichever days have a real
// (non-undefined) value on *both* sides — a day missing either value is
// dropped from the pair entirely, not treated as a zero. Returns null when
// there are fewer than 2 paired days, or when either series has zero
// variance across the paired days (a constant series makes r mathematically
// undefined — a 0/0 division, not a real coefficient of 0 — so this
// deliberately returns "no result" rather than a misleading zero).
function computeCorrelation(
  xs: (number | undefined)[],
  ys: (number | undefined)[],
): { coefficient: number; sampleSize: number } | null {
  const pairedX: number[] = [];
  const pairedY: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined || y === undefined) continue;
    pairedX.push(x);
    pairedY.push(y);
  }
  const n = pairedX.length;
  if (n < 2) return null;

  const meanX = average(pairedX);
  const meanY = average(pairedY);
  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;
  for (let i = 0; i < n; i++) {
    const dx = pairedX[i] - meanX;
    const dy = pairedY[i] - meanY;
    numerator += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }
  if (sumSqX === 0 || sumSqY === 0) return null;

  return { coefficient: numerator / Math.sqrt(sumSqX * sumSqY), sampleSize: n };
}

// One (pair, lagDays, direction) candidate check, factored out of
// getSummary's correlation loop once that loop needed to try each base pair
// up to twice per lag (forward and reverse — see the increment note in
// getSummary). Applies the exact same shift → compute → threshold-check →
// describe pipeline the loop always has, just callable for either A-leads-B
// or B-leads-A by handing it labels/series in the order the caller wants
// treated as "leading."
function evaluatePair(
  labelA: string,
  seriesA: (number | undefined)[],
  labelB: string,
  seriesB: (number | undefined)[],
  lagDays: number,
): MetricCorrelation | null {
  const { a, b } = shiftForLag(seriesA, seriesB, lagDays);
  const result = computeCorrelation(a, b);
  if (!result) return null;
  if (result.sampleSize < MIN_CORRELATION_SAMPLE_SIZE) return null;
  if (Math.abs(result.coefficient) < MIN_CORRELATION_ABS_R) return null;
  return {
    metricALabel: labelA,
    metricBLabel: labelB,
    lagDays,
    coefficient: round2(result.coefficient),
    sampleSize: result.sampleSize,
    description: describeCorrelation(labelA, labelB, result.coefficient, result.sampleSize, lagDays),
  };
}

// Realigns two day-indexed series so that metric A on day i is paired with
// metric B on day i + lagDays — i.e. "does A predict B one day later,"
// A leading B. `lagDays: 0` returns the series untouched (the original
// same-day pairing). Both returned arrays are the same length
// (`length - lagDays`), so a caller can hand them straight to
// `computeCorrelation` exactly as it already does for the same-day case —
// dropping days off each end rather than trying to wrap or reuse a day
// twice, since a day genuinely has no "day before the window started" to
// pair with.
function shiftForLag(
  seriesA: (number | undefined)[],
  seriesB: (number | undefined)[],
  lagDays: number,
): { a: (number | undefined)[]; b: (number | undefined)[] } {
  if (lagDays === 0) return { a: seriesA, b: seriesB };
  return {
    a: seriesA.slice(0, seriesA.length - lagDays),
    b: seriesB.slice(lagDays),
  };
}

// Plain-English rendering of one correlation result. Deliberately phrased
// as a tendency ("tends to come with"), never as causation — the underlying
// math can't tell "short sleep causes a lower mood" apart from "a lower
// mood causes worse sleep" apart from "something else entirely is causing
// both," and this app has no way to know which. `lagDays` changes the
// phrasing from a same-day claim to a later-day one, and swaps the sample
// count's unit from "days" to "N-day-apart pairs" — a lagged sample size
// counts consecutive-day pairs, not raw days, and saying so avoids implying
// it's the same kind of count as the same-day version right next to it.
// `lagDays: 1` keeps its own exact original "one day .../ the next day"
// wording (real backend e2e tests assert on that literal substring) rather
// than folding into the generic "N days later" phrasing every other lag
// value uses — this is the one deliberate special case in an otherwise
// generic function, not an oversight.
function describeCorrelation(labelA: string, labelB: string, r: number, n: number, lagDays: number): string {
  const absR = Math.abs(r);
  const strength = absR >= 0.6 ? 'strong' : absR >= 0.4 ? 'moderate' : 'slight';
  const direction = r > 0 ? `higher ${labelB.toLowerCase()}` : `lower ${labelB.toLowerCase()}`;
  if (lagDays === 0) {
    return `Higher ${labelA.toLowerCase()} tends to come with ${direction} in this window (${strength} correlation, r = ${r.toFixed(2)}, ${n} days with both logged).`;
  }
  if (lagDays === 1) {
    return `Higher ${labelA.toLowerCase()} one day tends to come with ${direction} the next day in this window (${strength} correlation, r = ${r.toFixed(2)}, ${n} one-day-apart pairs).`;
  }
  return `Higher ${labelA.toLowerCase()} tends to come with ${direction} ${lagDays} days later in this window (${strength} correlation, r = ${r.toFixed(2)}, ${n} ${lagDays}-day-apart pairs).`;
}
