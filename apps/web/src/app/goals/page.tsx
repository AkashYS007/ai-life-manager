'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { CREATE_GOAL, GOALS_QUERY, UPDATE_GOAL } from '../../lib/queries';
import { BottomNav } from '../../components/BottomNav';
import { QueryErrorNotice } from '../../components/QueryErrorNotice';

type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';

interface GoalRow {
  id: string;
  title: string;
  description?: string | null;
  targetDate?: string | null;
  status: GoalStatus;
  createdAt: string;
  // Goal progress view increment: computed fresh by the backend on every
  // read (see GoalsService.attachTaskCounts) — taskCount excludes
  // cancelled tasks, same "cancelled isn't counted against you" reasoning
  // the Tasks screen's own Open/Cancelled split already uses.
  taskCount: number;
  completedTaskCount: number;
  // Linking habits to goals increment: a plain count, not folded into
  // taskCount — habits are recurring with no terminal "done" state, so
  // they don't fit the "N of M done" framing the task progress bar uses.
  linkedHabitCount: number;
}

function formatTargetDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const TABS: { label: string; status: GoalStatus }[] = [
  { label: 'Active', status: 'ACTIVE' },
  { label: 'Completed', status: 'COMPLETED' },
  { label: 'Abandoned', status: 'ABANDONED' },
];

// One goal = one status-change mutation instance, same "independent
// per-row loading state" precedent as MorePage's CompletedTaskRow — clicking
// an action on one goal shouldn't disable every other row while its request
// is in flight.
function GoalRowView({ goal, refetchQueries }: { goal: GoalRow; refetchQueries: any[] }) {
  const [updateGoal, { loading }] = useMutation(UPDATE_GOAL, { refetchQueries });

  function setStatus(status: GoalStatus) {
    updateGoal({ variables: { id: goal.id, input: { status } } });
  }

  return (
    <div
      data-testid={`goal-card-${goal.id}`}
      className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3"
    >
      <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">{goal.title}</p>
      {goal.description && (
        <p className="mt-0.5 text-sm text-text-secondary dark:text-text-secondary-dark">{goal.description}</p>
      )}
      {goal.targetDate && (
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Target: {formatTargetDate(goal.targetDate)}
        </p>
      )}

      {/* Goal progress view increment: the info that matters ("3 of 5
          done") is always in real text, never conveyed by the bar's fill
          alone — the bar is a supplementary visual, not the only signal,
          matching this app's existing non-color-only convention. Shown
          only once at least one real task is linked; a freshly created
          goal with nothing linked yet gets a plain nudge instead of a
          confusing "0 of 0." */}
      {goal.taskCount > 0 ? (
        <div className="mt-2">
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {goal.completedTaskCount} of {goal.taskCount} task{goal.taskCount === 1 ? '' : 's'} done
          </p>
          <div
            role="progressbar"
            aria-valuenow={goal.completedTaskCount}
            aria-valuemin={0}
            aria-valuemax={goal.taskCount}
            aria-label={`${goal.title} progress: ${goal.completedTaskCount} of ${goal.taskCount} tasks done`}
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-background dark:bg-background-dark"
          >
            <div
              className="h-full rounded-full bg-accent dark:bg-accent-dark"
              style={{ width: `${Math.round((goal.completedTaskCount / goal.taskCount) * 100)}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          No tasks linked yet — link one from Today&apos;s quick-add box.
        </p>
      )}

      {goal.linkedHabitCount > 0 && (
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          {goal.linkedHabitCount} habit{goal.linkedHabitCount === 1 ? '' : 's'} linked
        </p>
      )}

      <div className="mt-2 flex gap-3">
        {goal.status === 'ACTIVE' && (
          <>
            <button
              disabled={loading}
              onClick={() => setStatus('COMPLETED')}
              className="text-xs font-medium text-accent dark:text-accent-dark disabled:opacity-50"
            >
              Mark complete
            </button>
            <button
              disabled={loading}
              onClick={() => setStatus('ABANDONED')}
              className="text-xs text-text-secondary hover:text-danger dark:hover:text-danger-dark dark:text-text-secondary-dark disabled:opacity-50"
            >
              Abandon
            </button>
          </>
        )}
        {goal.status !== 'ACTIVE' && (
          <button
            disabled={loading}
            onClick={() => setStatus('ACTIVE')}
            className="text-xs text-text-secondary hover:text-accent dark:text-text-secondary-dark disabled:opacity-50"
          >
            Reactivate
          </button>
        )}
      </div>
    </div>
  );
}

function NewGoalForm({ refetchQueries }: { refetchQueries: any[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [createGoal, { loading }] = useMutation(CREATE_GOAL, { refetchQueries });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    const result = await createGoal({
      variables: {
        input: {
          title: trimmed,
          description: description.trim() || undefined,
          targetDate: targetDate ? new Date(targetDate).toISOString() : undefined,
        },
      },
    });
    const errors = result.data?.createGoal?.errors ?? [];
    if (errors.length > 0) {
      setError(errors[0].message ?? "Couldn't create that goal. Try again.");
      return;
    }
    setTitle('');
    setDescription('');
    setTargetDate('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mx-4 mb-3 rounded-control border border-border dark:border-border-dark px-4 py-2 text-sm font-medium text-text-primary dark:text-text-primary-dark"
      >
        + New goal
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-4 mb-3 flex flex-col gap-2 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Goal title…"
        aria-label="Goal title"
        autoFocus
        disabled={loading}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'new-goal-error' : undefined}
        className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)…"
        aria-label="Description"
        rows={2}
        disabled={loading}
        className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
        Target date (optional)
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          disabled={loading}
          className="ml-2 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
        />
      </label>

      {error && (
        <p id="new-goal-error" className="text-xs text-danger dark:text-danger-dark" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Create goal'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-control px-4 py-2 text-sm text-text-secondary dark:text-text-secondary-dark"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// Long-horizon objectives that tasks (and, per the PRD, habits) ladder up
// to (PRD §7.3). The one real gap the post-launch feature audit found: the
// backend (Goal model, GoalsService/Resolver, Task.goalId/goal) has existed
// since the first Tasks increment, but nothing on the frontend ever
// reached it — this is that missing screen, plus wiring goalId into
// QuickAddTask (see that file) so linkage is actually usable end to end,
// not just theoretically queryable.
export default function GoalsPage() {
  const [tab, setTab] = useState<GoalStatus>('ACTIVE');
  // Deliberately network-only, not the default cache-first — same reasoning
  // as POMODORO_SETTINGS_QUERY on /focus and REFLECTION_LABELS_QUERY on
  // /reflection (see either's own comment for the full explanation): the
  // persisted cache (apollo-client.ts's initCachePersistence) can rehydrate
  // a snapshot of this exact query+variables pair from an earlier visit in
  // the same session — e.g. a goal's progress as it looked before a task
  // linked to it got completed on /today — and cache-first would happily
  // keep showing that stale snapshot on every later /goals visit forever,
  // since it never re-checks the server once something's already cached.
  const { data, loading, error, refetch } = useQuery(GOALS_QUERY, {
    variables: { status: tab },
    fetchPolicy: 'cache-and-network',
  });
  const refetchQueries = [{ query: GOALS_QUERY, variables: { status: tab } }];

  const goals: GoalRow[] = data?.goals ?? [];

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Goals</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Long-horizon objectives your tasks ladder up to.
        </p>
      </div>

      {/* Screen-reader pass: this previously conveyed the active tab by
          color alone (no ARIA state at all) — see the Tasks screen's own
          tablist just above for the same upgrade and its documented
          keyboard-navigation scope cut. */}
      <div className="mx-4 mb-3 flex gap-4" role="tablist" aria-label="Goal status">
        {TABS.map((t) => (
          <button
            key={t.status}
            role="tab"
            aria-selected={tab === t.status}
            onClick={() => setTab(t.status)}
            className={
              tab === t.status
                ? 'text-sm font-medium text-accent dark:text-accent-dark'
                : 'text-sm text-text-secondary dark:text-text-secondary-dark'
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <NewGoalForm refetchQueries={refetchQueries} />

      {loading && <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>}

      {error && <QueryErrorNotice error={error} what="your goals" onRetry={() => refetch()} />}

      {!loading && !error && (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {goals.length ? (
            goals.map((goal) => <GoalRowView key={goal.id} goal={goal} refetchQueries={refetchQueries} />)
          ) : (
            <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-5">
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                {tab === 'ACTIVE'
                  ? "No active goals yet — add one above, then link tasks to it from Today's quick-add box."
                  : `No ${tab.toLowerCase()} goals.`}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
