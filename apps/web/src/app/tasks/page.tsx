'use client';

import { useState } from 'react';
import { useQuery } from '@apollo/client';
import Link from 'next/link';
import { ALL_GOALS_QUERY, CANCELLED_TASKS_QUERY, OPEN_TASKS_QUERY } from '../../lib/queries';
import { BottomNav } from '../../components/BottomNav';
import { TaskEditRow } from '../../components/TaskEditRow';

type Tab = 'OPEN' | 'CANCELLED';

// Tasks list/edit screen increment: closes the longest-standing real gap
// in this app — `updateTask`/`cancelTask`/`createTag` have all been real,
// working mutations since the very first Tasks increment, but there was
// never a dedicated screen to actually use them beyond the narrow "Edit
// task" control inside a plan review row (see AiPlanCard). Reachable via a
// **Tasks →** link on Today, same not-a-nav-tab pattern as
// Goals/Focus/Reflection/Routines/Notifications/Insights — no eighth
// bottom-nav item. Completed tasks intentionally stay on the existing
// `/more` page rather than being duplicated here as a third tab.
//
// Tasks pagination increment: each tab now runs its own independently
// cursor-paginated query (OPEN_TASKS_QUERY / CANCELLED_TASKS_QUERY — see
// queries.ts's own comment on why this replaced one unfiltered `first: 100`
// query) rather than one query pre-fetching and client-filtering
// everything. `skip` on whichever tab isn't currently active means
// switching tabs the first time always fires a real network request (no
// pre-fetching the other tab speculatively) — the same "only fetch what's
// actually being looked at" tradeoff Chat's per-conversation query already
// makes.
export default function TasksPage() {
  const [tab, setTab] = useState<Tab>('OPEN');

  const {
    data: openData,
    loading: openLoading,
    error: openError,
    fetchMore: fetchMoreOpen,
  } = useQuery(OPEN_TASKS_QUERY, { skip: tab !== 'OPEN' });

  const {
    data: cancelledData,
    loading: cancelledLoading,
    error: cancelledError,
    fetchMore: fetchMoreCancelled,
  } = useQuery(CANCELLED_TASKS_QUERY, { skip: tab !== 'CANCELLED' });

  const { data: goalsData } = useQuery(ALL_GOALS_QUERY, { errorPolicy: 'ignore' });
  const goals = goalsData?.goals ?? [];

  const activeData = tab === 'OPEN' ? openData : cancelledData;
  const loading = tab === 'OPEN' ? openLoading : cancelledLoading;
  const error = tab === 'OPEN' ? openError : cancelledError;
  const fetchMore = tab === 'OPEN' ? fetchMoreOpen : fetchMoreCancelled;

  const edges = activeData?.tasks?.edges ?? [];
  const shown = edges.map((e: any) => e.node);
  const pageInfo = activeData?.tasks?.pageInfo;

  function loadMore() {
    if (!pageInfo?.hasNextPage) return;
    fetchMore({
      variables: { after: pageInfo.endCursor },
      updateQuery: (prev: any, { fetchMoreResult }: any) => {
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
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Tasks</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Edit anything about a task — title, description, priority, due date, duration, goal link, tags.{' '}
          <Link href="/more" className="text-accent underline">
            Completed tasks →
          </Link>
        </p>
      </div>

      {/* Screen-reader pass: upgraded from aria-pressed (toggle-button
          semantics) to real tab semantics, since this genuinely switches
          which panel of tasks is shown below, not just a standalone
          on/off state. Note: real ARIA tabs also call for roving-tabindex
          arrow-key navigation (WAI-ARIA Authoring Practices' Tabs
          pattern); that part is deliberately not implemented here — each
          tab stays individually Tab-focusable via plain <button> default
          behavior instead, which still keeps Tab/Shift+Tab/Enter/Space
          fully operable, just without Left/Right-arrow switching. */}
      <div className="mx-4 mb-3 flex gap-1 rounded-control border border-border dark:border-border-dark p-0.5 w-fit" role="tablist" aria-label="Task status">
        {(['OPEN', 'CANCELLED'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-control px-3 py-1 text-xs ${
              tab === t ? 'bg-accent text-white' : 'text-text-secondary dark:text-text-secondary-dark'
            }`}
          >
            {t === 'OPEN' ? 'Open' : 'Cancelled'}
          </button>
        ))}
      </div>

      {loading && <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>}

      {error && (
        <p className="mx-4 mb-3 text-sm text-danger dark:text-danger-dark" role="alert">
          Couldn&apos;t load your tasks. Check that the backend is running.
        </p>
      )}

      {!loading && !error && (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {shown.length ? (
            shown.map((task: any) => <TaskEditRow key={task.id} task={task} goals={goals} />)
          ) : (
            <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-5">
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                {tab === 'OPEN'
                  ? 'Nothing open — add a task from Today to see it here.'
                  : 'No cancelled tasks.'}
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
