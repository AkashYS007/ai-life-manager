'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { CREATE_HABIT, GOALS_QUERY, HABITS_QUERY, TODAY_PLAN_QUERY } from '../lib/queries';
import { HabitRecurrenceFields, HabitRecurrenceValue } from './HabitRecurrenceFields';

const DEFAULT_RECURRENCE: HabitRecurrenceValue = {
  frequency: 'DAILY',
  daysOfWeek: [],
  intervalDays: 1,
  intervalWeeks: 1,
  monthlyMode: 'DAY_OF_MONTH',
  dayOfMonth: 1,
  lastDayOfMonth: false,
  monthlyWeekday: 1,
  monthlyOrdinal: 1,
  intervalMonths: 1,
  endMode: 'NEVER',
  count: 1,
  until: '',
  daysOfMonth: [],
  monthlyWeekdaySet: [],
};

// "Simple patterns first" scope (the original approved Habits increment):
// daily, or specific days of the week. The Full custom habit recurrence
// increment adds four more real shapes on top: every N days, every N
// weeks, monthly on a day-of-month (or the last day), and monthly on the
// Nth (or last) weekday — see rrule.ts's own comment on the backend for
// why these six and not a fully general RRULE editor. The recurrence picker
// itself now lives in HabitRecurrenceFields (Habit-edit UI increment),
// shared with the new edit form in HabitManageRow — no behavior change
// here, same fields, same defaults, just relocated.
//
// Linking habits to goals increment: the goal picker mirrors QuickAddTask's
// own exact reasoning — only ACTIVE goals are offered. Habit-edit UI
// increment: this is still the *create*-time picker only (still
// active-only, unchanged); the edit form below now lets this be changed
// afterward, which used to be impossible.
export function CreateHabitForm() {
  const [title, setTitle] = useState('');
  const [recurrence, setRecurrence] = useState<HabitRecurrenceValue>(DEFAULT_RECURRENCE);
  const [preferredTime, setPreferredTime] = useState('');
  const [goalId, setGoalId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: goalsData } = useQuery(GOALS_QUERY, { variables: { status: 'ACTIVE' }, errorPolicy: 'ignore' });
  const activeGoals: Array<{ id: string; title: string }> = goalsData?.goals ?? [];

  const [createHabit, { loading }] = useMutation(CREATE_HABIT, {
    refetchQueries: [{ query: HABITS_QUERY, variables: { activeOnly: false } }, { query: TODAY_PLAN_QUERY }],
  });

  const {
    frequency,
    daysOfWeek,
    intervalDays,
    intervalWeeks,
    monthlyMode,
    dayOfMonth,
    lastDayOfMonth,
    monthlyWeekday,
    monthlyOrdinal,
    intervalMonths,
    endMode,
    count,
    until,
    daysOfMonth,
    monthlyWeekdaySet,
  } = recurrence;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (!trimmed) return;

    const result = await createHabit({
      variables: {
        title: trimmed,
        frequency,
        daysOfWeek: frequency === 'WEEKLY' ? daysOfWeek : undefined,
        // Sending `undefined` (not 1) for a plain, non-interval habit keeps
        // every already-working plain daily/weekly habit's request
        // identical to before this increment — only an actual "every N"
        // choice adds anything new to the request at all.
        intervalDays: frequency === 'DAILY' && intervalDays > 1 ? intervalDays : undefined,
        intervalWeeks: frequency === 'WEEKLY' && intervalWeeks > 1 ? intervalWeeks : undefined,
        monthlyMode: frequency === 'MONTHLY' ? monthlyMode : undefined,
        dayOfMonth:
          frequency === 'MONTHLY' && monthlyMode === 'DAY_OF_MONTH' ? (lastDayOfMonth ? -1 : dayOfMonth) : undefined,
        monthlyWeekday: frequency === 'MONTHLY' && monthlyMode === 'NTH_WEEKDAY' ? monthlyWeekday : undefined,
        // BYSETPOS / multiple weekdays per month increment — monthlyOrdinal
        // is shared by NTH_WEEKDAY and NTH_WEEKDAY_SET (see
        // HabitRecurrenceValue's own comment).
        monthlyOrdinal:
          frequency === 'MONTHLY' && (monthlyMode === 'NTH_WEEKDAY' || monthlyMode === 'NTH_WEEKDAY_SET') ? monthlyOrdinal : undefined,
        daysOfMonth: frequency === 'MONTHLY' && monthlyMode === 'DAYS_OF_MONTH' ? daysOfMonth : undefined,
        monthlyWeekdaySet: frequency === 'MONTHLY' && monthlyMode === 'NTH_WEEKDAY_SET' ? monthlyWeekdaySet : undefined,
        intervalMonths: frequency === 'MONTHLY' && intervalMonths > 1 ? intervalMonths : undefined,
        // Fuller habit recurrence increment — `endMode` is local-only form
        // state (see HabitRecurrenceValue's own comment); only one of
        // count/until is ever actually sent, mirroring the mutual
        // exclusivity rrule.ts's buildRrule enforces server-side.
        count: endMode === 'COUNT' ? count : undefined,
        until: endMode === 'UNTIL' && until ? until : undefined,
        preferredTime: preferredTime || undefined,
        goalId: goalId || undefined,
      },
    });
    const payload = result.data?.createHabit;
    if (payload?.errors?.length) {
      setError(payload.errors[0].message);
      return;
    }

    setTitle('');
    setRecurrence(DEFAULT_RECURRENCE);
    setPreferredTime('');
    setGoalId('');
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-4 mb-3 flex flex-col gap-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4"
    >
      {error && <p className="text-xs text-danger dark:text-danger-dark" role="alert">{error}</p>}

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New habit…"
        aria-label="Habit title"
        disabled={loading}
        className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
      />

      <HabitRecurrenceFields value={recurrence} onChange={setRecurrence} disabled={loading} />

      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary dark:text-text-secondary-dark">Preferred time</span>
        <input
          type="time"
          value={preferredTime}
          onChange={(e) => setPreferredTime(e.target.value)}
          aria-label="Preferred time"
          disabled={loading}
          className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1.5 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <span className="text-xs text-text-secondary dark:text-text-secondary-dark">(optional)</span>
      </div>

      {/* Linking habits to goals increment — same "only offer ACTIVE goals,
          only shown once one actually exists" reasoning as QuickAddTask's
          identical picker. */}
      {activeGoals.length > 0 && (
        <select
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
          disabled={loading}
          aria-label="Link to goal"
          className="w-fit rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-secondary dark:text-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">No goal</option>
          {activeGoals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      )}

      <button
        type="submit"
        disabled={
          loading ||
          !title.trim() ||
          (frequency === 'WEEKLY' && daysOfWeek.length === 0) ||
          (frequency === 'MONTHLY' && monthlyMode === 'DAYS_OF_MONTH' && daysOfMonth.length < 2) ||
          (frequency === 'MONTHLY' && monthlyMode === 'NTH_WEEKDAY_SET' && monthlyWeekdaySet.length === 0) ||
          (endMode === 'UNTIL' && !until)
        }
        className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Add habit
      </button>
    </form>
  );
}
