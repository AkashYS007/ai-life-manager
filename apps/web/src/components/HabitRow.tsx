'use client';

import { useMutation } from '@apollo/client';
import { COMPLETE_HABIT_LOG, UNCOMPLETE_HABIT_LOG, TODAY_PLAN_QUERY } from '../lib/queries';

// Same checkbox-first layout as TaskRow, but toggleable both ways — a
// misclick on a habit checkbox should be a one-tap undo, unlike completing
// a task (which is a one-way state transition in this app).
export function HabitRow({
  id,
  title,
  preferredTime,
  todayCompleted,
}: {
  id: string;
  title: string;
  preferredTime?: string | null;
  todayCompleted: boolean;
}) {
  const refetchQueries = [{ query: TODAY_PLAN_QUERY }];
  const [completeLog, { loading: completing }] = useMutation(COMPLETE_HABIT_LOG, { refetchQueries });
  const [uncompleteLog, { loading: uncompleting }] = useMutation(UNCOMPLETE_HABIT_LOG, { refetchQueries });
  const loading = completing || uncompleting;

  function toggle() {
    const variables = { habitId: id, date: new Date().toISOString() };
    if (todayCompleted) {
      uncompleteLog({ variables });
    } else {
      completeLog({ variables });
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5">
      <button
        type="button"
        aria-label={todayCompleted ? `Mark "${title}" not done` : `Mark "${title}" done`}
        aria-pressed={todayCompleted}
        disabled={loading}
        onClick={toggle}
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 text-[11px] leading-none text-white disabled:opacity-50 ${
          todayCompleted
            ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
            : 'border-text-secondary dark:border-text-secondary-dark'
        }`}
      >
        {todayCompleted ? '✓' : ''}
      </button>
      <span
        className={`flex-1 text-sm ${
          todayCompleted
            ? 'text-text-secondary line-through dark:text-text-secondary-dark'
            : 'text-text-primary dark:text-text-primary-dark'
        }`}
      >
        {title}
      </span>
      {preferredTime && (
        <span className="text-xs text-text-secondary dark:text-text-secondary-dark">{preferredTime}</span>
      )}
    </div>
  );
}
