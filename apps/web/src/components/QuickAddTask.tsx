'use client';

import { useState } from 'react';
import { useMutation, useLazyQuery, useQuery } from '@apollo/client';
import { CREATE_TASK, ESTIMATE_TASK_DURATION, GOALS_QUERY, TODAY_PLAN_QUERY } from '../lib/queries';
import { applyOptimisticCreateTask, enqueue, isOnline } from '../lib/offlineQueue';

// Minimal quick-capture input (UI/UX Design Document §6.2) — the full
// natural-language parsing version arrives once the AI layer is built;
// this is the plain, honest version: type a title, press enter. The
// duration field is the one addition from the Task duration estimation
// increment — plain number entry like any other input, plus an optional
// "AI" button that fills it in via a suggestion; it never runs on its own,
// since a per-keystroke AI call for a field nobody's asked about yet would
// be wasted cost. The goal picker is the Goals increment's addition: the
// backend has always accepted a `goalId` on createTask, but nothing on the
// frontend ever let a person actually set one — this closes that. Only
// ACTIVE goals are offered (same "don't let someone unknowingly link to a
// goal they already gave up on" reasoning a real product would apply),
// and it's the one query on this component with an unhandled-error policy
// left at its Apollo default rather than swallowed, since an empty
// dropdown here is a harmless, self-explanatory failure state (just shows
// "No goal" as the only option) rather than one that needs its own error UI.
export function QuickAddTask() {
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('');
  const [goalId, setGoalId] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: goalsData } = useQuery(GOALS_QUERY, { variables: { status: 'ACTIVE' }, errorPolicy: 'ignore' });
  const [createTask, { loading }] = useMutation(CREATE_TASK, {
    refetchQueries: [{ query: TODAY_PLAN_QUERY }],
  });
  const [estimateDuration, { loading: estimating }] = useLazyQuery(ESTIMATE_TASK_DURATION, {
    fetchPolicy: 'network-only',
  });

  const activeGoals: Array<{ id: string; title: string }> = goalsData?.goals ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitError(null);
    const estimatedDurationMinutes = duration.trim() ? parseInt(duration, 10) : undefined;
    const variables = { title: trimmed, estimatedDurationMinutes, goalId: goalId || undefined };

    // PWA + offline support increment: the PRD specifically names "adding
    // a task" as something that must work with no connection and sync on
    // reconnect. Checked up front (not just caught after a failed
    // request) so the person gets the instant optimistic row immediately,
    // not a spinner that eventually times out.
    if (!isOnline()) {
      // Fix (frontend audit, 2026-08-25): the optimistic placeholder id is
      // now threaded through to enqueue() as this item's optimisticId — see
      // offlineQueue.ts's QueuedMutation.optimisticId comment for why,
      // without it, completing this same task before reconnecting silently
      // lost the completion.
      const optimisticId = applyOptimisticCreateTask(variables);
      enqueue('createTask', variables, optimisticId);
    } else {
      try {
        const result = await createTask({ variables });
        // Fix (frontend audit, 2026-08-25): a server-side validation
        // rejection comes back as this payload's own `errors[]`, not a
        // thrown exception — previously never checked, so a rejected task
        // silently cleared the form as if it had been created. Deliberately
        // NOT queued for offline retry (unlike the thrown-exception branch
        // below) since a genuine rejection would just fail the same way
        // again.
        const payloadErrors = result.data?.createTask?.errors;
        if (payloadErrors?.length) {
          setSubmitError(payloadErrors[0].message ?? "Couldn't add that task. Try again.");
          return;
        }
      } catch {
        // A flaky connection that looked online a moment ago — same
        // fallback path as the explicit offline check above, so a
        // half-dropped wifi signal doesn't just lose the task outright.
        const optimisticId = applyOptimisticCreateTask(variables);
        enqueue('createTask', variables, optimisticId);
      }
    }
    setTitle('');
    setDuration('');
    setGoalId('');
  }

  async function handleAiEstimate() {
    const trimmed = title.trim();
    if (!trimmed) return;
    const { data } = await estimateDuration({ variables: { title: trimmed } });
    if (typeof data?.estimateTaskDuration === 'number') {
      setDuration(String(data.estimateTaskDuration));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-4 mb-2 flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          aria-label="Task title"
          disabled={loading}
          className="flex-1 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <input
          value={duration}
          onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="min"
          aria-label="Estimated duration in minutes"
          inputMode="numeric"
          disabled={loading}
          className="w-14 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="button"
          onClick={handleAiEstimate}
          disabled={loading || estimating || !title.trim()}
          title="Estimate with AI"
          aria-label="Estimate duration with AI"
          className="rounded-control border border-border px-2 py-2 text-xs text-text-secondary hover:text-ai-accent disabled:opacity-50 dark:border-border-dark dark:text-text-secondary-dark"
        >
          {estimating ? '…' : 'AI'}
        </button>
        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {/* Only shown once at least one active goal exists — an empty select
          with nothing but "No goal" in it would just be clutter for anyone
          who hasn't used Goals yet (see /goals for creating one). */}
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

      {submitError && (
        <p className="text-xs text-danger dark:text-danger-dark" role="alert">
          {submitError}
        </p>
      )}
    </form>
  );
}
