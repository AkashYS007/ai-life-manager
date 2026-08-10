'use client';

import { useState } from 'react';
import { useQuery } from '@apollo/client';
import { ANALYTICS_SUMMARY_QUERY } from '../../lib/queries';
import { BottomNav } from '../../components/BottomNav';
import { TrendChart } from '../../components/TrendChart';

const WINDOW_OPTIONS = [
  { label: '2 weeks', days: 14 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

interface DailyMoodEnergy {
  date: string;
  averageMood?: number | null;
  averageEnergy?: number | null;
}
interface DailySleep {
  date: string;
  durationMinutes?: number | null;
  qualityScore?: number | null;
}
interface HabitStreak {
  habitId: string;
  title: string;
  currentStreak: number;
  dueDaysInWindow: number;
  completedDaysInWindow: number;
  completionRatePercent: number;
}
interface RoutineConsistency {
  type: 'MORNING' | 'EVENING';
  currentStreak: number;
  daysInWindow: number;
  completedDaysInWindow: number;
  completionRatePercent: number;
}
interface MetricCorrelation {
  metricALabel: string;
  metricBLabel: string;
  lagDays: number;
  coefficient: number;
  sampleSize: number;
  description: string;
}
interface DailyTaskCompletion {
  date: string;
  completedCount: number;
}
interface DailyFocusMinutes {
  date: string;
  completedMinutes: number;
  completedSessions: number;
}
interface FocusSessionConsistency {
  currentStreak: number;
  daysInWindow: number;
  completedDaysInWindow: number;
  completionRatePercent: number;
}
interface DailyJournalActivity {
  date: string;
  entryCount: number;
}

function formatShortDate(dateStr: string): string {
  // dateStr is a plain "YYYY-MM-DD" — parsed as UTC (no time component) and
  // formatted with the UTC calendar fields so the label always shows the
  // exact date the backend meant, regardless of the browser's own
  // timezone shifting it to the day before/after.
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function StreakCard({
  title,
  currentStreak,
  completionRatePercent,
  completedDaysInWindow,
  totalDaysInWindow,
  dayNoun,
}: {
  title: string;
  currentStreak: number;
  completionRatePercent: number;
  completedDaysInWindow: number;
  totalDaysInWindow: number;
  dayNoun: string;
}) {
  return (
    <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3">
      <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">{title}</p>
      <div className="mt-1.5 flex items-baseline gap-4">
        <div>
          <p className="text-lg font-medium text-ai-accent dark:text-ai-accent-dark">{currentStreak}</p>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">{dayNoun} streak</p>
        </div>
        <div>
          <p className="text-lg font-medium text-text-primary dark:text-text-primary-dark">{completionRatePercent}%</p>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {completedDaysInWindow} of {totalDaysInWindow} {dayNoun} done
          </p>
        </div>
      </div>
    </div>
  );
}

// Life analytics / trend views increment (PRD §7.3) — closes the
// single most-repeated remaining "not built yet" line in this README:
// no history or charting UI over any of the data this app has been
// logging since the Signal tracking, Habits, and Routines increments.
// Everything on this page is read-only aggregation, computed fresh by
// AnalyticsService on every load — nothing new is persisted, and nothing
// here can be edited from this screen (correcting a mood check-in or a
// habit's completion history still happens wherever it was originally
// logged, not here).
export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const { data, loading, error } = useQuery(ANALYTICS_SUMMARY_QUERY, { variables: { days } });

  const summary = data?.analyticsSummary;
  const dailyMoodEnergy: DailyMoodEnergy[] = summary?.dailyMoodEnergy ?? [];
  const dailySleep: DailySleep[] = summary?.dailySleep ?? [];
  const habitStreaks: HabitStreak[] = summary?.habitStreaks ?? [];
  const routineConsistency: RoutineConsistency[] = summary?.routineConsistency ?? [];
  const correlations: MetricCorrelation[] = summary?.correlations ?? [];
  const dailyTaskCompletions: DailyTaskCompletion[] = summary?.dailyTaskCompletions ?? [];
  const dailyFocusMinutes: DailyFocusMinutes[] = summary?.dailyFocusMinutes ?? [];
  const focusSessionConsistency: FocusSessionConsistency | undefined = summary?.focusSessionConsistency;
  const dailyJournalActivity: DailyJournalActivity[] = summary?.dailyJournalActivity ?? [];

  const hasAnyMoodOrEnergy = dailyMoodEnergy.some((d) => d.averageMood != null || d.averageEnergy != null);
  const hasAnySleep = dailySleep.some((d) => d.durationMinutes != null);
  // Unlike mood/energy/sleep, these three series always have a real number
  // for every day (never null) — "hasAny" here means "did anything actually
  // happen at least once," not "was anything ever logged," since a zero
  // itself is already a real, known value either way.
  const hasAnyTaskCompletions = dailyTaskCompletions.some((d) => d.completedCount > 0);
  const hasAnyFocusMinutes = dailyFocusMinutes.some((d) => d.completedMinutes > 0);
  const hasAnyJournalActivity = dailyJournalActivity.some((d) => d.entryCount > 0);

  const sleepDurations = dailySleep.map((d) => d.durationMinutes).filter((v): v is number => v != null);
  const maxSleepHours = sleepDurations.length ? Math.max(8, Math.ceil(Math.max(...sleepDurations) / 60)) : 10;
  const maxTaskCompletions = Math.max(1, ...dailyTaskCompletions.map((d) => d.completedCount));
  const maxFocusMinutes = Math.max(30, ...dailyFocusMinutes.map((d) => d.completedMinutes));
  const maxJournalEntries = Math.max(1, ...dailyJournalActivity.map((d) => d.entryCount));

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Insights</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Trends from your check-ins, habits, and routines — read-only, nothing here can be edited directly.
        </p>
      </div>

      <div className="mx-4 mb-3 flex gap-1 self-start rounded-control border border-border dark:border-border-dark p-0.5">
        {WINDOW_OPTIONS.map((opt) => (
          <button
            key={opt.days}
            onClick={() => setDays(opt.days)}
            aria-pressed={days === opt.days}
            className={`rounded-control px-2 py-1 text-xs ${
              days === opt.days ? 'bg-accent text-white' : 'text-text-secondary dark:text-text-secondary-dark'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading && <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>}

      {error && (
        <p className="mx-4 mb-3 text-sm text-danger dark:text-danger-dark" role="alert">
          Couldn&apos;t load your insights. Check that the backend is running.
        </p>
      )}

      {!loading && !error && (
        <div className="mx-4 mb-3 flex flex-col gap-3">
          {/* Mood + energy trend */}
          <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-text-primary dark:text-text-primary-dark">Mood &amp; energy</h2>
              <div className="flex gap-3 text-xs">
                <span className="flex items-center gap-1 text-text-secondary dark:text-text-secondary-dark">
                  <span className="h-2 w-2 rounded-full bg-accent dark:bg-accent-dark" /> Mood
                </span>
                <span className="flex items-center gap-1 text-text-secondary dark:text-text-secondary-dark">
                  <span className="h-2 w-2 rounded-full bg-ai-accent dark:bg-ai-accent-dark" /> Energy
                </span>
              </div>
            </div>
            {hasAnyMoodOrEnergy ? (
              <>
                <TrendChart
                  min={1}
                  max={5}
                  series={[
                    {
                      label: 'Mood',
                      points: dailyMoodEnergy.map((d) => ({ date: d.date, value: d.averageMood })),
                      colorClassName: 'text-accent dark:text-accent-dark',
                    },
                    {
                      label: 'Energy',
                      points: dailyMoodEnergy.map((d) => ({ date: d.date, value: d.averageEnergy })),
                      colorClassName: 'text-ai-accent dark:text-ai-accent-dark',
                    },
                  ]}
                />
                <div className="mt-1 flex justify-between text-xs text-text-secondary dark:text-text-secondary-dark">
                  <span>{formatShortDate(dailyMoodEnergy[0].date)}</span>
                  <span>{formatShortDate(dailyMoodEnergy[dailyMoodEnergy.length - 1].date)}</span>
                </div>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
                No mood or energy check-ins in this window yet — log one from Today.
              </p>
            )}
          </div>

          {/* Sleep trend */}
          <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3">
            <h2 className="mb-2 text-sm font-medium text-text-primary dark:text-text-primary-dark">Sleep duration</h2>
            {hasAnySleep ? (
              <>
                <TrendChart
                  min={0}
                  max={maxSleepHours * 60}
                  series={[
                    {
                      label: 'Sleep',
                      points: dailySleep.map((d) => ({ date: d.date, value: d.durationMinutes })),
                      colorClassName: 'text-accent dark:text-accent-dark',
                    },
                  ]}
                />
                <div className="mt-1 flex justify-between text-xs text-text-secondary dark:text-text-secondary-dark">
                  <span>{formatShortDate(dailySleep[0].date)}</span>
                  <span>{formatShortDate(dailySleep[dailySleep.length - 1].date)}</span>
                </div>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
                No sleep logged in this window yet — log it from Today.
              </p>
            )}
          </div>

          {/* Task completion trend — Insights: trends increment. Unlike
              Mood/energy and Sleep above, a day with zero completions is a
              real, known zero (see the model comment on DailyTaskCompletion
              server-side), so this only falls back to the empty state when
              literally nothing was completed anywhere in the whole window —
              not merely "no data logged." */}
          <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3">
            <h2 className="mb-2 text-sm font-medium text-text-primary dark:text-text-primary-dark">Tasks completed</h2>
            {hasAnyTaskCompletions ? (
              <>
                <TrendChart
                  min={0}
                  max={maxTaskCompletions}
                  series={[
                    {
                      label: 'Completed',
                      points: dailyTaskCompletions.map((d) => ({ date: d.date, value: d.completedCount })),
                      colorClassName: 'text-accent dark:text-accent-dark',
                    },
                  ]}
                />
                <div className="mt-1 flex justify-between text-xs text-text-secondary dark:text-text-secondary-dark">
                  <span>{formatShortDate(dailyTaskCompletions[0].date)}</span>
                  <span>{formatShortDate(dailyTaskCompletions[dailyTaskCompletions.length - 1].date)}</span>
                </div>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
                No tasks completed in this window yet.
              </p>
            )}
          </div>

          {/* Habit streaks */}
          {habitStreaks.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-medium text-text-primary dark:text-text-primary-dark">Habit streaks</h2>
              <div className="flex flex-col gap-2">
                {habitStreaks.map((h) => (
                  <StreakCard
                    key={h.habitId}
                    title={h.title}
                    currentStreak={h.currentStreak}
                    completionRatePercent={h.completionRatePercent}
                    completedDaysInWindow={h.completedDaysInWindow}
                    totalDaysInWindow={h.dueDaysInWindow}
                    dayNoun="due day"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Routine consistency */}
          {routineConsistency.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-medium text-text-primary dark:text-text-primary-dark">Routine consistency</h2>
              <div className="flex flex-col gap-2">
                {routineConsistency.map((r) => (
                  <StreakCard
                    key={r.type}
                    title={r.type === 'MORNING' ? 'Morning routine' : 'Evening routine'}
                    currentStreak={r.currentStreak}
                    completionRatePercent={r.completionRatePercent}
                    completedDaysInWindow={r.completedDaysInWindow}
                    totalDaysInWindow={r.daysInWindow}
                    dayNoun="day"
                  />
                ))}
              </div>
            </div>
          )}

          {habitStreaks.length === 0 && routineConsistency.length === 0 && (
            <p className="text-center text-xs text-text-secondary dark:text-text-secondary-dark">
              Set up a habit or a routine to see streaks and consistency here.
            </p>
          )}

          {/* Focus session trend + consistency — Insights: trends increment.
              Real elapsed minutes for COMPLETED sessions only (see the
              model comment on DailyFocusMinutes server-side); the streak
              card below always renders, even at a real 0-day streak/0%,
              same "an honest zero is still real information" reasoning the
              trend chart above it uses — unlike Habit streaks/Routine
              consistency, there's no "hasn't been set up yet" state to hide
              behind, since focus sessions don't need any setup at all. */}
          <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3">
            <h2 className="mb-2 text-sm font-medium text-text-primary dark:text-text-primary-dark">Focus sessions</h2>
            {hasAnyFocusMinutes ? (
              <>
                <TrendChart
                  min={0}
                  max={maxFocusMinutes}
                  series={[
                    {
                      label: 'Focused minutes',
                      points: dailyFocusMinutes.map((d) => ({ date: d.date, value: d.completedMinutes })),
                      colorClassName: 'text-ai-accent dark:text-ai-accent-dark',
                    },
                  ]}
                />
                <div className="mt-1 flex justify-between text-xs text-text-secondary dark:text-text-secondary-dark">
                  <span>{formatShortDate(dailyFocusMinutes[0].date)}</span>
                  <span>{formatShortDate(dailyFocusMinutes[dailyFocusMinutes.length - 1].date)}</span>
                </div>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
                No completed focus sessions in this window yet.
              </p>
            )}
          </div>
          {focusSessionConsistency && (
            <StreakCard
              title="Focus session consistency"
              currentStreak={focusSessionConsistency.currentStreak}
              completionRatePercent={focusSessionConsistency.completionRatePercent}
              completedDaysInWindow={focusSessionConsistency.completedDaysInWindow}
              totalDaysInWindow={focusSessionConsistency.daysInWindow}
              dayNoun="day"
            />
          )}

          {/* Journal activity trend — same real-zero reasoning as Tasks
              completed above. */}
          <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3">
            <h2 className="mb-2 text-sm font-medium text-text-primary dark:text-text-primary-dark">Journal activity</h2>
            {hasAnyJournalActivity ? (
              <>
                <TrendChart
                  min={0}
                  max={maxJournalEntries}
                  series={[
                    {
                      label: 'Entries',
                      points: dailyJournalActivity.map((d) => ({ date: d.date, value: d.entryCount })),
                      colorClassName: 'text-accent dark:text-accent-dark',
                    },
                  ]}
                />
                <div className="mt-1 flex justify-between text-xs text-text-secondary dark:text-text-secondary-dark">
                  <span>{formatShortDate(dailyJournalActivity[0].date)}</span>
                  <span>{formatShortDate(dailyJournalActivity[dailyJournalActivity.length - 1].date)}</span>
                </div>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
                No journal entries in this window yet — write one from Journal.
              </p>
            )}
          </div>

          {/* Cross-metric correlations — unlike the sections above, this one
              always renders (even with zero results) rather than hiding
              itself, since "we checked and nothing stood out yet" is itself
              an honest, useful thing to say rather than something to hide. */}
          <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3">
            <h2 className="mb-1 text-sm font-medium text-text-primary dark:text-text-primary-dark">Patterns worth noting</h2>
            {correlations.length > 0 ? (
              <ul className="mt-2 flex list-none flex-col gap-2 pl-0">
                {correlations.map((c) => (
                  <li
                    key={`${c.metricALabel}-${c.metricBLabel}-${c.lagDays}`}
                    className="rounded-control border border-border dark:border-border-dark p-2 text-sm text-text-primary dark:text-text-primary-dark"
                  >
                    {/* A text label, not a color-only cue — same-day is the
                        default and gets no badge at all; any lagged result
                        gets one so it's never mistaken for the same-day
                        version of the same pair. Multi-day / reverse-lag
                        increment: lagDays can now be 1, 2, or 3, so the
                        badge says which — "Next-day" reads more naturally
                        than "1 day later" for the single most common case,
                        everything past that just states the number. */}
                    {c.lagDays > 0 && (
                      <span className="mr-1.5 rounded-full border border-border dark:border-border-dark px-1.5 py-0.5 text-xs text-text-secondary dark:text-text-secondary-dark">
                        {c.lagDays === 1 ? 'Next-day' : `${c.lagDays} days later`}
                      </span>
                    )}
                    {c.description}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
                Not enough data yet to spot a clear pattern between your sleep, mood, energy, and habits — keep
                logging and check back.
              </p>
            )}
            <p className="mt-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              These describe patterns in your own logged data, not proven cause and effect.
            </p>
          </div>
        </div>
      )}

      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
