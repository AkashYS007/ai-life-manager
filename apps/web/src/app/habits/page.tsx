'use client';

import { useQuery } from '@apollo/client';
import { ALL_GOALS_QUERY, HABITS_QUERY } from '../../lib/queries';
import { CreateHabitForm } from '../../components/CreateHabitForm';
import { HabitManageRow } from '../../components/HabitManageRow';
import { BottomNav } from '../../components/BottomNav';
import { QueryErrorNotice } from '../../components/QueryErrorNotice';

export default function HabitsPage() {
  const { data, loading, error, refetch } = useQuery(HABITS_QUERY, { variables: { activeOnly: false } });
  // Habit-edit UI increment: same ALL_GOALS_QUERY (every goal, any status,
  // not just ACTIVE) the Tasks screen's own edit row already uses — an
  // edit form needs to keep showing a habit's *currently* linked goal even
  // if that goal has since been completed or abandoned, not just the ones
  // still offered when linking fresh.
  const { data: goalsData } = useQuery(ALL_GOALS_QUERY, { errorPolicy: 'ignore' });
  const goals = goalsData?.goals ?? [];

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Habits</h1>
      </div>

      <CreateHabitForm />

      {loading && (
        <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>
      )}

      {error && <QueryErrorNotice error={error} what="your habits" onRetry={() => refetch()} />}

      {!loading && !error && (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {data?.habits?.length ? (
            data.habits.map((habit: any) => <HabitManageRow key={habit.id} habit={habit} goals={goals} />)
          ) : (
            <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-5">
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                No habits yet — add one above to see it on your Today screen.
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
