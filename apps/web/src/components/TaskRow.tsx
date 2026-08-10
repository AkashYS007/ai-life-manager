'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useLazyQuery } from '@apollo/client';
import { COMPLETE_TASK, FOCUSED_MINUTES_FOR_TASK, TODAY_PLAN_QUERY } from '../lib/queries';
import { applyOptimisticCompleteTask, enqueue, isOnline } from '../lib/offlineQueue';

// Checkbox-first layout, matching the Task row component spec (UI/UX
// Design Document §7.1). Only the pending/in-progress states are needed
// for this increment — overdue styling and drag-to-reschedule arrive with
// the Calendar feature.
export function TaskRow({
  id,
  title,
  priority,
  estimatedDurationMinutes,
  goalTitle,
  subtasks,
}: {
  id: string;
  title: string;
  priority: number;
  estimatedDurationMinutes?: number | null;
  goalTitle?: string | null;
  subtasks?: { id: string; status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' }[];
}) {
  // Subtask UI increment: Today's row is deliberately read-only about
  // this — a small "N/M subtasks" count, not the full add/toggle/remove
  // list the Tasks screen's TaskEditRow has room for. Cancelled subtasks
  // are excluded from both the numerator and denominator, same as the full
  // SubtaskList's own "removed means hidden, not just crossed out" rule.
  const visibleSubtasks = (subtasks ?? []).filter((s) => s.status !== 'CANCELLED');
  const doneSubtasks = visibleSubtasks.filter((s) => s.status === 'COMPLETED').length;
  // Task duration estimation increment: checking the box doesn't complete
  // the task immediately anymore — it opens this small inline prompt for
  // the actual time spent first. "Skip" still completes the task with no
  // actual duration recorded, same as before this increment existed, so a
  // person in a hurry never has to stop and think about this to finish a
  // task.
  const [confirming, setConfirming] = useState(false);
  const [actualMinutes, setActualMinutes] = useState('');
  // Focus sessions feed task duration back increment: tracks whether the
  // current `actualMinutes` value is the real number pulled from a
  // completed focus session, purely so the hint text below the input knows
  // when to show itself — editing the field by hand (even to the exact
  // same digits) clears it, since at that point it's the person's own
  // number again, not a claim about where it came from.
  const [fromFocusSession, setFromFocusSession] = useState(false);
  // Plain ref, not state — this only ever needs to be read once, inside
  // onCompleted below, never re-rendered on. True the moment the person
  // types anything into the field by hand, so a slow-resolving query can
  // never clobber a number they've already started entering themselves.
  const userEditedRef = useRef(false);
  const [completeTask, { loading }] = useMutation(COMPLETE_TASK, {
    refetchQueries: [{ query: TODAY_PLAN_QUERY }],
  });
  // Fired the moment the checkbox is clicked (see onClick below) — a real,
  // explicit "I'm completing this task" action already, not a per-keystroke
  // cost the way QuickAddTask's separate "AI" button guards against; a
  // single cheap local aggregate query costs nothing extra to just run
  // automatically right when it's actually useful.
  const [fetchFocusedMinutes] = useLazyQuery(FOCUSED_MINUTES_FOR_TASK, {
    variables: { taskId: id },
    fetchPolicy: 'network-only',
    onCompleted: (data) => {
      const minutes = data?.focusedMinutesForTask;
      if (typeof minutes === 'number' && minutes > 0 && !userEditedRef.current) {
        setActualMinutes(String(minutes));
        setFromFocusSession(true);
      }
    },
  });

  async function submitCompletion(withActual: boolean) {
    const actualDurationMinutes = withActual && actualMinutes.trim() ? parseInt(actualMinutes, 10) : undefined;
    const variables = { id, actualDurationMinutes };

    // PWA + offline support increment: "completing a task" is the second
    // of the PRD's three named offline-capable actions. Same
    // check-first-then-fallback shape as QuickAddTask's createTask path.
    if (!isOnline()) {
      applyOptimisticCompleteTask(id);
      enqueue('completeTask', variables);
      return;
    }
    try {
      await completeTask({ variables });
    } catch {
      applyOptimisticCompleteTask(id);
      enqueue('completeTask', variables);
    }
  }

  if (confirming) {
    return (
      <div
        data-testid={`today-task-row-${id}`}
        className="flex flex-col gap-1 rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5"
      >
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm text-text-primary dark:text-text-primary-dark">
            How long did &quot;{title}&quot; actually take?
          </span>
          <input
            value={actualMinutes}
            onChange={(e) => {
              userEditedRef.current = true;
              setFromFocusSession(false);
              setActualMinutes(e.target.value.replace(/[^0-9]/g, ''));
            }}
            placeholder="min"
            aria-label={`Actual time spent on "${title}", in minutes`}
            inputMode="numeric"
            autoFocus
            disabled={loading}
            className="w-14 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            disabled={loading}
            onClick={() => submitCompletion(true)}
            className="rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Done
          </button>
          <button
            disabled={loading}
            onClick={() => submitCompletion(false)}
            className="text-xs text-text-secondary hover:text-text-primary dark:text-text-secondary-dark"
          >
            Skip
          </button>
        </div>
        {/* Focus sessions feed task duration back increment: makes clear
            this number is a real, pulled-in value the person can still
            change, not a fixed answer — same "never silently apply a
            number without saying where it came from" instinct as every
            other AI/computed suggestion in this app. */}
        {fromFocusSession && (
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            From your focus sessions on this task — feel free to change it.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid={`today-task-row-${id}`}
      className="flex items-center gap-3 rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5"
    >
      <button
        aria-label={`Mark "${title}" complete`}
        disabled={loading}
        onClick={() => {
          setConfirming(true);
          fetchFocusedMinutes();
        }}
        className="h-[18px] w-[18px] shrink-0 rounded-[5px] border-2 border-text-secondary dark:border-text-secondary-dark disabled:opacity-50"
      />
      <div className="flex-1">
        <p className="text-sm text-text-primary dark:text-text-primary-dark">{title}</p>
        {/* Goals increment: shows which goal a task ladders up to, right on
            the row — the same "linkage should be visible, not just
            queryable" reasoning behind wiring the picker into QuickAddTask
            in the first place. */}
        {goalTitle && (
          <p className="text-xs text-ai-accent dark:text-ai-accent-dark">{goalTitle}</p>
        )}
      </div>
      {estimatedDurationMinutes != null && (
        <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
          ~{estimatedDurationMinutes}m
        </span>
      )}
      {visibleSubtasks.length > 0 && (
        <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
          {doneSubtasks}/{visibleSubtasks.length} subtasks
        </span>
      )}
      {priority === 1 && (
        <span className="text-xs font-medium text-danger dark:text-danger-dark">Urgent</span>
      )}
      {/* Focus sessions increment (UI/UX Design Document §4's "tied to the
          current scheduled task"): pre-fills the /focus page's start form
          with this task rather than starting the session from here — the
          actual startFocusSession call happens on /focus once the person
          confirms a duration, same "navigate, then commit" pattern the
          Google/Microsoft "Connect" buttons use for their own redirects. */}
      <Link
        href={`/focus?taskId=${id}&title=${encodeURIComponent(title)}`}
        className="text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark"
      >
        Focus
      </Link>
    </div>
  );
}
