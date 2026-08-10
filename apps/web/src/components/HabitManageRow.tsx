'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { DEACTIVATE_HABIT, HABITS_QUERY, REACTIVATE_HABIT, TODAY_PLAN_QUERY, UPDATE_HABIT } from '../lib/queries';
import { HabitRecurrenceFields, HabitRecurrenceValue } from './HabitRecurrenceFields';

const DAY_ABBR: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
const WEEKDAY_NAME: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};
const ORDINAL_WORD: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' };

function ordinalDay(day: number): string {
  if (day === -1) return 'last day';
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  return `${day}${suffix}`;
}

// Full custom habit recurrence increment: describes all six shapes rrule.ts
// supports, not just the original two — see this file's own props comment
// for which fields matter for which frequency.
function recurrenceLabel(props: {
  frequency: string;
  daysOfWeek?: number[] | null;
  intervalDays?: number | null;
  intervalWeeks?: number | null;
  monthlyMode?: string | null;
  dayOfMonth?: number | null;
  monthlyWeekday?: number | null;
  monthlyOrdinal?: number | null;
  daysOfMonth?: number[] | null;
  monthlyWeekdaySet?: number[] | null;
  intervalMonths?: number | null;
  count?: number | null;
  until?: string | null;
}): string {
  const {
    frequency,
    daysOfWeek,
    intervalDays,
    intervalWeeks,
    monthlyMode,
    dayOfMonth,
    monthlyWeekday,
    monthlyOrdinal,
    daysOfMonth,
    monthlyWeekdaySet,
    intervalMonths,
    count,
    until,
  } = props;

  let base: string;
  if (frequency === 'DAILY') {
    base = intervalDays && intervalDays > 1 ? `Every ${intervalDays} days` : 'Every day';
  } else if (frequency === 'WEEKLY') {
    const days = daysOfWeek && daysOfWeek.length > 0 ? daysOfWeek.map((d) => DAY_ABBR[d]).join(', ') : 'Weekly';
    base = intervalWeeks && intervalWeeks > 1 ? `Every ${intervalWeeks} weeks: ${days}` : days;
  } else {
    // MONTHLY
    const cadence = intervalMonths && intervalMonths > 1 ? `every ${intervalMonths} months` : 'monthly';
    const monthlyPrefix = cadence === 'monthly' ? 'Monthly' : `Every ${intervalMonths} months`;
    if (monthlyMode === 'NTH_WEEKDAY' && monthlyWeekday && monthlyOrdinal) {
      base = `${monthlyPrefix}, ${ORDINAL_WORD[monthlyOrdinal] ?? monthlyOrdinal} ${WEEKDAY_NAME[monthlyWeekday]}`;
    } else if (monthlyMode === 'DAYS_OF_MONTH' && daysOfMonth && daysOfMonth.length > 0) {
      // BYSETPOS / multiple weekdays per month increment.
      base = `${monthlyPrefix} on the ${daysOfMonth.map((d) => ordinalDay(d)).join(', ')}`;
    } else if (monthlyMode === 'NTH_WEEKDAY_SET' && monthlyWeekdaySet && monthlyWeekdaySet.length > 0 && monthlyOrdinal) {
      const days = monthlyWeekdaySet.map((d) => DAY_ABBR[d]).join('/');
      base = `${monthlyPrefix}, ${ORDINAL_WORD[monthlyOrdinal] ?? monthlyOrdinal} ${days} day`;
    } else if (dayOfMonth) {
      base = `${monthlyPrefix} on the ${ordinalDay(dayOfMonth)}`;
    } else {
      base = monthlyPrefix;
    }
  }

  // Fuller habit recurrence increment: mutually exclusive per rrule.ts's own
  // buildRrule, so at most one of these ever appends.
  if (count) return `${base} · ${count} time${count === 1 ? '' : 's'} total`;
  if (until) return `${base} · until ${until}`;
  return base;
}

interface HabitDetail {
  id: string;
  title: string;
  frequency: string;
  daysOfWeek?: number[] | null;
  intervalDays?: number | null;
  intervalWeeks?: number | null;
  monthlyMode?: string | null;
  dayOfMonth?: number | null;
  monthlyWeekday?: number | null;
  monthlyOrdinal?: number | null;
  daysOfMonth?: number[] | null;
  monthlyWeekdaySet?: number[] | null;
  intervalMonths?: number | null;
  count?: number | null;
  until?: string | null;
  preferredTime?: string | null;
  protectedDurationMinutes: number;
  active: boolean;
  goal?: { id: string; title: string } | null;
}

interface GoalOption {
  id: string;
  title: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
}

function toRecurrenceValue(habit: HabitDetail): HabitRecurrenceValue {
  return {
    frequency: (habit.frequency as HabitRecurrenceValue['frequency']) ?? 'DAILY',
    daysOfWeek: habit.daysOfWeek ?? [],
    intervalDays: habit.intervalDays ?? 1,
    intervalWeeks: habit.intervalWeeks ?? 1,
    monthlyMode: (habit.monthlyMode as HabitRecurrenceValue['monthlyMode']) ?? 'DAY_OF_MONTH',
    dayOfMonth: habit.dayOfMonth && habit.dayOfMonth > 0 ? habit.dayOfMonth : 1,
    lastDayOfMonth: habit.dayOfMonth === -1,
    monthlyWeekday: habit.monthlyWeekday ?? 1,
    monthlyOrdinal: habit.monthlyOrdinal ?? 1,
    intervalMonths: habit.intervalMonths ?? 1,
    endMode: habit.count ? 'COUNT' : habit.until ? 'UNTIL' : 'NEVER',
    count: habit.count ?? 1,
    until: habit.until ?? '',
    daysOfMonth: habit.daysOfMonth ?? [],
    monthlyWeekdaySet: habit.monthlyWeekdaySet ?? [],
  };
}

// Habit-edit UI increment: the edit half of this row — every field a habit
// can be created with (title, all six recurrence shapes via the shared
// HabitRecurrenceFields, preferred time, protected duration, goal link) can
// now be changed afterward too, closing the gap named repeatedly throughout
// this README ("no habit-edit UI of any kind"). `updateHabit` itself
// already existed on the backend before this increment — this is
// specifically the first UI ever built for it, plus the small
// `reactivateHabit` addition alongside it (see that mutation's own comment
// for why deactivating used to be a one-way trap).
export function HabitManageRow({ habit, goals }: { habit: HabitDetail; goals: GoalOption[] }) {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(habit.title);
  const [recurrence, setRecurrence] = useState<HabitRecurrenceValue>(() => toRecurrenceValue(habit));
  const [preferredTime, setPreferredTime] = useState(habit.preferredTime ?? '');
  const [protectedDurationMinutes, setProtectedDurationMinutes] = useState(String(habit.protectedDurationMinutes));
  const [goalId, setGoalId] = useState(habit.goal?.id ?? '');

  const refetchQueries = [{ query: HABITS_QUERY, variables: { activeOnly: false } }, { query: TODAY_PLAN_QUERY }];
  const [deactivateHabit, { loading: deactivating }] = useMutation(DEACTIVATE_HABIT, {
    variables: { id: habit.id },
    refetchQueries,
  });
  const [reactivateHabit, { loading: reactivating }] = useMutation(REACTIVATE_HABIT, {
    variables: { id: habit.id },
    refetchQueries,
  });
  const [updateHabit, { loading: saving }] = useMutation(UPDATE_HABIT, { refetchQueries });

  function resetDraft() {
    setTitle(habit.title);
    setRecurrence(toRecurrenceValue(habit));
    setPreferredTime(habit.preferredTime ?? '');
    setProtectedDurationMinutes(String(habit.protectedDurationMinutes));
    setGoalId(habit.goal?.id ?? '');
    setError(null);
  }

  async function handleSave() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required.');
      return;
    }
    if (recurrence.frequency === 'WEEKLY' && recurrence.daysOfWeek.length === 0) {
      setError('Pick at least one day of the week.');
      return;
    }
    if (recurrence.frequency === 'MONTHLY' && recurrence.monthlyMode === 'DAYS_OF_MONTH' && recurrence.daysOfMonth.length < 2) {
      setError('Pick at least 2 days of the month.');
      return;
    }
    if (recurrence.frequency === 'MONTHLY' && recurrence.monthlyMode === 'NTH_WEEKDAY_SET' && recurrence.monthlyWeekdaySet.length === 0) {
      setError('Pick at least one weekday.');
      return;
    }
    if (recurrence.endMode === 'UNTIL' && !recurrence.until) {
      setError('Pick an end date, or switch back to "Never".');
      return;
    }
    setError(null);

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
      daysOfMonth,
      monthlyWeekdaySet,
      intervalMonths,
      endMode,
      count,
      until,
    } = recurrence;

    const result = await updateHabit({
      variables: {
        id: habit.id,
        title: trimmedTitle,
        frequency,
        daysOfWeek: frequency === 'WEEKLY' ? daysOfWeek : undefined,
        intervalDays: frequency === 'DAILY' && intervalDays > 1 ? intervalDays : undefined,
        intervalWeeks: frequency === 'WEEKLY' && intervalWeeks > 1 ? intervalWeeks : undefined,
        monthlyMode: frequency === 'MONTHLY' ? monthlyMode : undefined,
        dayOfMonth:
          frequency === 'MONTHLY' && monthlyMode === 'DAY_OF_MONTH' ? (lastDayOfMonth ? -1 : dayOfMonth) : undefined,
        monthlyWeekday: frequency === 'MONTHLY' && monthlyMode === 'NTH_WEEKDAY' ? monthlyWeekday : undefined,
        // BYSETPOS / multiple weekdays per month increment — monthlyOrdinal
        // is shared by NTH_WEEKDAY and NTH_WEEKDAY_SET.
        monthlyOrdinal:
          frequency === 'MONTHLY' && (monthlyMode === 'NTH_WEEKDAY' || monthlyMode === 'NTH_WEEKDAY_SET') ? monthlyOrdinal : undefined,
        daysOfMonth: frequency === 'MONTHLY' && monthlyMode === 'DAYS_OF_MONTH' ? daysOfMonth : undefined,
        monthlyWeekdaySet: frequency === 'MONTHLY' && monthlyMode === 'NTH_WEEKDAY_SET' ? monthlyWeekdaySet : undefined,
        intervalMonths: frequency === 'MONTHLY' && intervalMonths > 1 ? intervalMonths : undefined,
        // Fuller habit recurrence increment — explicit `null` (not
        // `undefined`) for whichever of count/until is *not* the chosen
        // endMode, so switching to "Never" (or from COUNT to UNTIL) actually
        // clears the other one server-side, per UpdateHabitInput's own
        // explicit-null-clears convention (see that file's comment on
        // count/until).
        count: endMode === 'COUNT' ? count : null,
        until: endMode === 'UNTIL' ? until : null,
        preferredTime: preferredTime || null,
        protectedDurationMinutes: protectedDurationMinutes.trim() ? parseInt(protectedDurationMinutes, 10) : undefined,
        // Explicit `null` (not `undefined`) clears the link — see
        // UpdateHabitInput.goalId's own comment on why that distinction
        // matters to Prisma.
        goalId: goalId || null,
      },
    });
    const payload = result.data?.updateHabit;
    if (payload?.errors?.length) {
      setError(payload.errors[0].message);
      return;
    }
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <div
        data-testid={`habit-row-${habit.id}`}
        className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark px-3 py-3"
      >
        <div className="flex flex-col gap-3">
          {error && <p className="text-xs text-danger dark:text-danger-dark" role="alert">{error}</p>}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Habit title"
            disabled={saving}
            className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1.5 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
          />

          <HabitRecurrenceFields value={recurrence} onChange={setRecurrence} disabled={saving} />

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              Preferred time
              <input
                type="time"
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
                aria-label="Preferred time"
                disabled={saving}
                className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              Protect
              <input
                type="number"
                min={1}
                value={protectedDurationMinutes}
                onChange={(e) => setProtectedDurationMinutes(e.target.value.replace(/[^0-9]/g, ''))}
                aria-label="Protected duration in minutes"
                disabled={saving}
                className="w-16 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
              />
              min
            </label>
          </div>

          <select
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            disabled={saving}
            aria-label="Link to goal"
            className="w-fit rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-secondary dark:text-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">No goal</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
                {g.status !== 'ACTIVE' ? ` (${g.status.toLowerCase()})` : ''}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <button
              disabled={saving}
              onClick={handleSave}
              className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => {
                setIsEditing(false);
                resetDraft();
              }}
              className="rounded-control border border-border dark:border-border-dark px-3 py-1.5 text-xs font-medium text-text-secondary dark:text-text-secondary-dark"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={`habit-row-${habit.id}`}
      className="flex items-center gap-3 rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5"
    >
      <div className="flex-1">
        <p
          className={`text-sm ${
            habit.active ? 'text-text-primary dark:text-text-primary-dark' : 'text-text-secondary line-through dark:text-text-secondary-dark'
          }`}
        >
          {habit.title}
        </p>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          {recurrenceLabel(habit)}
          {habit.preferredTime && ` · ${habit.preferredTime}`}
        </p>
        {habit.goal && <p className="text-xs text-ai-accent dark:text-ai-accent-dark">{habit.goal.title}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          onClick={() => setIsEditing(true)}
          className="text-xs font-medium text-accent dark:text-accent-dark"
        >
          Edit
        </button>
        {habit.active ? (
          <button
            disabled={deactivating}
            onClick={() => deactivateHabit()}
            className="text-xs text-text-secondary hover:text-danger dark:hover:text-danger-dark dark:text-text-secondary-dark disabled:opacity-50"
          >
            Deactivate
          </button>
        ) : (
          <button
            disabled={reactivating}
            onClick={() => reactivateHabit()}
            className="text-xs text-text-secondary hover:text-accent dark:text-text-secondary-dark disabled:opacity-50"
          >
            Reactivate
          </button>
        )}
      </div>
    </div>
  );
}
