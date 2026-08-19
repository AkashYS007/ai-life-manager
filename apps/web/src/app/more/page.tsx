'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { COMPLETED_TASKS_QUERY, REOPEN_TASK, TODAY_PLAN_QUERY } from '../../lib/queries';
import { BottomNav } from '../../components/BottomNav';
import { QueryErrorNotice } from '../../components/QueryErrorNotice';

// Originally view-only, per that increment's approved scope. The
// un-completing-a-task increment added the "Undo" button below — the
// tasks(status: COMPLETED, ...) connection this reuses already existed and
// was already e2e-tested in the Tasks increment; this page is the first
// thing on the frontend to actually query it.
function relativeCompletedLabel(completedAt: string): string {
  const completed = new Date(completedAt);
  const now = new Date();
  const startOfCompletedDay = new Date(completed.getFullYear(), completed.getMonth(), completed.getDate());
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfCompletedDay.getTime()) / (24 * 60 * 60 * 1000));

  const time = completed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (dayDiff <= 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Yesterday at ${time}`;
  if (dayDiff < 7) return `${dayDiff} days ago`;
  return completed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// One row = one mutation instance, so each row's own loading/error state
// stays independent — clicking Undo on one completed task shouldn't disable
// or blank out every other row while its request is in flight. Refetches
// both this page's list (the task should disappear from here) and
// TODAY_PLAN_QUERY (it should reappear on Today, same as any other open
// task) — matches the refetch pairing TaskRow.tsx already uses in reverse
// for completeTask.
function CompletedTaskRow({ id, title, completedAt }: { id: string; title: string; completedAt: string }) {
  const [error, setError] = useState<string | null>(null);
  const [reopenTask, { loading }] = useMutation(REOPEN_TASK, {
    variables: { id },
    refetchQueries: [{ query: COMPLETED_TASKS_QUERY }, { query: TODAY_PLAN_QUERY }],
  });

  async function handleUndo() {
    setError(null);
    const result = await reopenTask();
    const errors = result.data?.reopenTask?.errors ?? [];
    if (errors.length > 0) {
      setError(errors[0].message ?? "Couldn't reopen that task. Try again.");
    }
  }

  return (
    <div className="rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-sm text-text-primary dark:text-text-primary-dark line-through">{title}</p>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {relativeCompletedLabel(completedAt)}
          </p>
        </div>
        <button
          disabled={loading}
          onClick={handleUndo}
          className="text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark disabled:opacity-50"
        >
          Undo
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger dark:text-danger-dark" role="alert">{error}</p>}
    </div>
  );
}

export default function MorePage() {
  const { data, loading, error, fetchMore, refetch } = useQuery(COMPLETED_TASKS_QUERY);

  const edges = data?.tasks?.edges ?? [];
  const pageInfo = data?.tasks?.pageInfo;

  function loadMore() {
    if (!pageInfo?.hasNextPage) return;
    fetchMore({
      variables: { after: pageInfo.endCursor },
      updateQuery: (prev, { fetchMoreResult }) => {
        if (!fetchMoreResult) return prev;
        return {
          tasks: {
            ...fetchMoreResult.tasks,
            edges: [...prev.tasks.edges, ...fetchMoreResult.tasks.edges],
          },
        };
      },
    });
  }

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Completed tasks</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Everything you&apos;ve checked off on Today, most recent first.
        </p>
      </div>

      {loading && (
        <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>
      )}

      {error && <QueryErrorNotice error={error} what="your completed tasks" onRetry={() => refetch()} />}

      {!loading && !error && (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {edges.length ? (
            edges.map((edge: { node: { id: string; title: string; completedAt: string } }) => (
              <CompletedTaskRow
                key={edge.node.id}
                id={edge.node.id}
                title={edge.node.title}
                completedAt={edge.node.completedAt}
              />
            ))
          ) : (
            <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-5">
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                Nothing completed yet — checked-off tasks from Today will show up here.
              </p>
            </div>
          )}

          {pageInfo?.hasNextPage && (
            <button
              onClick={loadMore}
              className="mt-1 rounded-control border border-border dark:border-border-dark px-4 py-2 text-sm font-medium text-text-primary dark:text-text-primary-dark"
            >
              Load more
            </button>
          )}
        </div>
      )}

      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
