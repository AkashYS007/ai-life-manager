'use client';

import { useQuery } from '@apollo/client';
import {
  TODAY_PLAN_QUERY,
  TODAY_ROUTINES_QUERY,
  TODAY_RECOMMENDATIONS_QUERY,
  UNREAD_NOTIFICATION_COUNT_QUERY,
} from '../../lib/queries';
import { TodayHeader } from '../../components/TodayHeader';
import { PlanEmptyState } from '../../components/PlanEmptyState';
import { BottomNav } from '../../components/BottomNav';
import { QuickAddTask } from '../../components/QuickAddTask';
import { TaskRow } from '../../components/TaskRow';
import { CalendarEventRow } from '../../components/CalendarEventRow';
import { DailyCheckIn } from '../../components/DailyCheckIn';
import { AiPlanCard } from '../../components/AiPlanCard';
import { WeeklyPlanCard } from '../../components/WeeklyPlanCard';
import { AiRecommendationsCard } from '../../components/AiRecommendationsCard';
import { HabitRow } from '../../components/HabitRow';
import { RoutineChecklist } from '../../components/RoutineChecklist';
import { OfflineSyncBanner } from '../../components/OfflineSyncBanner';
import { QueryErrorNotice } from '../../components/QueryErrorNotice';
import Link from 'next/link';

export default function TodayPage() {
  const { data, loading, error, refetch } = useQuery(TODAY_PLAN_QUERY);
  // Separate query/module from the plan (RoutinesModule, not TodayModule —
  // see routines.module.ts), so a routines fetch failure never blocks the
  // rest of Today from rendering; errors are swallowed here on purpose,
  // matching AiPlanCard's own "an enhancement must never break the page"
  // precedent.
  const { data: routinesData } = useQuery(TODAY_ROUTINES_QUERY);
  // Same reasoning again for recommendations (RecommendationsModule).
  const { data: recommendationsData } = useQuery(TODAY_RECOMMENDATIONS_QUERY);
  // And again for the notifications unread badge (NotificationsModule).
  const { data: unreadData } = useQuery(UNREAD_NOTIFICATION_COUNT_QUERY);

  if (loading) {
    return (
      <main id="main-content" className="mx-auto max-w-md py-10 text-center text-sm text-text-secondary dark:text-text-secondary-dark">
        Loading your day…
      </main>
    );
  }

  if (error) {
    return (
      <main id="main-content" className="mx-auto max-w-md py-10">
        <QueryErrorNotice error={error} what="your day" onRetry={() => refetch()} />
      </main>
    );
  }

  const plan = data.todayPlan;
  const name = plan.user.displayName ?? plan.user.email.split('@')[0];

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <TodayHeader greeting={plan.greeting} name={name} />

      {/* Focus sessions increment: the only entry point to /focus that
          doesn't come from a specific task's "Focus" link (see TaskRow) —
          not in the bottom nav on purpose, since the UI/UX Design
          Document's mobile navigation (§4) doesn't list Focus as a tab;
          this keeps it reachable without adding an eighth nav item. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-5 pb-1">
        <Link href="/focus" className="text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark">
          Start a focus session →
        </Link>
        {/* Daily reflection increment: same "not a bottom-nav tab" reasoning
            as Focus — the UI/UX Design Document's mobile nav (§4) doesn't
            list it either, so a small link here keeps it reachable without
            an eighth nav item. */}
        <Link href="/reflection" className="text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark">
          Reflect on today →
        </Link>
        {/* Morning/evening routines increment: same reasoning again — no
            eighth bottom-nav tab, reachable from Today instead. */}
        <Link href="/routines" className="text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark">
          Set up routines →
        </Link>
        {/* Smart notifications increment: same "not a bottom-nav tab"
            reasoning as the three links above. */}
        <Link href="/notifications" className="text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark">
          Notifications{unreadData?.unreadNotificationCount ? ` (${unreadData.unreadNotificationCount})` : ''} →
        </Link>
        {/* Goals increment: same "not a bottom-nav tab" reasoning as the
            four links above — no ninth tab, reachable from Today instead. */}
        <Link href="/goals" className="text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark">
          Goals →
        </Link>
        {/* Life analytics increment: same "not a bottom-nav tab" reasoning
            as the five links above — no tenth tab, reachable from Today
            instead. */}
        <Link href="/analytics" className="text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark">
          Insights →
        </Link>
        {/* Tasks list/edit screen increment: same "not a bottom-nav tab"
            reasoning as the six links above — no eleventh tab, reachable
            from Today instead. */}
        <Link href="/tasks" className="text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark">
          Tasks →
        </Link>
        {/* Visible settings screen increment: same "not a bottom-nav tab"
            reasoning as the seven links above — no twelfth tab, reachable
            from Today instead. */}
        <Link href="/settings" className="text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark">
          Settings →
        </Link>
      </div>

      <OfflineSyncBanner />

      {(routinesData?.todayRoutines ?? []).map(
        (routine: {
          id: string;
          type: 'MORNING' | 'EVENING';
          steps: { id: string; label: string }[];
          aiSequenced: boolean;
          completedStepIds: string[];
        }) => (
          <RoutineChecklist
            key={routine.id}
            id={routine.id}
            type={routine.type}
            steps={routine.steps}
            aiSequenced={routine.aiSequenced}
            completedStepIds={routine.completedStepIds}
          />
        ),
      )}

      <DailyCheckIn
        todayMood={plan.todayMood}
        todayEnergy={plan.todayEnergy}
        lastNightSleep={plan.lastNightSleep}
      />

      <AiPlanCard latestPlanRun={plan.latestPlanRun} openTasks={plan.tasks} />

      <WeeklyPlanCard openTasks={plan.tasks} />

      <AiRecommendationsCard recommendationRun={recommendationsData?.todayRecommendations} />

      {plan.habits.length > 0 && (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {plan.habits.map(
            (habit: { id: string; title: string; preferredTime?: string | null; todayCompleted: boolean }) => (
              <HabitRow
                key={habit.id}
                id={habit.id}
                title={habit.title}
                preferredTime={habit.preferredTime}
                todayCompleted={habit.todayCompleted}
              />
            ),
          )}
        </div>
      )}

      {plan.hasEvents && (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {plan.events.map(
            (event: {
              id: string;
              title: string;
              startTime: string;
              endTime: string;
              isImmovable: boolean;
              source: string;
            }) => (
              <CalendarEventRow
                key={event.id}
                id={event.id}
                title={event.title}
                startTime={event.startTime}
                endTime={event.endTime}
                isImmovable={event.isImmovable}
                source={event.source}
                refetchQueries={[{ query: TODAY_PLAN_QUERY }]}
              />
            ),
          )}
        </div>
      )}

      {plan.hasTasks ? (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {plan.tasks.map(
            (task: {
              id: string;
              title: string;
              priority: number;
              estimatedDurationMinutes?: number | null;
              goal?: { id: string; title: string } | null;
              subtasks?: { id: string; status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' }[];
            }) => (
              <TaskRow
                key={task.id}
                id={task.id}
                title={task.title}
                priority={task.priority}
                estimatedDurationMinutes={task.estimatedDurationMinutes}
                goalTitle={task.goal?.title}
                subtasks={task.subtasks}
              />
            ),
          )}
        </div>
      ) : (
        !plan.hasEvents && <PlanEmptyState />
      )}

      <QuickAddTask />
      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
