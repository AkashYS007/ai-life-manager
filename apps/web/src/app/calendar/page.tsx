'use client';

import { Suspense, useState } from 'react';
import { useQuery } from '@apollo/client';
import { CALENDAR_EVENTS_IN_RANGE, TODAY_PLAN_QUERY } from '../../lib/queries';
import { CalendarEventRow } from '../../components/CalendarEventRow';
import { QuickAddEvent } from '../../components/QuickAddEvent';
import { GoogleCalendarConnect } from '../../components/GoogleCalendarConnect';
import { MicrosoftCalendarConnect } from '../../components/MicrosoftCalendarConnect';
import { AppleCalendarConnect } from '../../components/AppleCalendarConnect';
import { BottomNav } from '../../components/BottomNav';

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// Day view — a week/month grid is a natural follow-up once this is proven
// out, matching how Tasks shipped list-only before any board/grouped view.
export default function CalendarPage() {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const rangeStart = startOfDay(day);
  const rangeEnd = addDays(rangeStart, 1);

  const rangeVariables = { start: rangeStart.toISOString(), end: rangeEnd.toISOString() };
  const { data, loading, error } = useQuery(CALENDAR_EVENTS_IN_RANGE, {
    variables: rangeVariables,
  });

  const refetchQueries = [
    { query: CALENDAR_EVENTS_IN_RANGE, variables: rangeVariables },
    { query: TODAY_PLAN_QUERY },
  ];

  const label = day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const isToday = startOfDay(new Date()).getTime() === rangeStart.getTime();

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="flex items-center justify-between px-5 pt-6 pb-3">
        <button
          aria-label="Previous day"
          onClick={() => setDay((d) => addDays(d, -1))}
          className="rounded-control px-2 py-1 text-sm text-text-secondary hover:text-text-primary dark:text-text-secondary-dark"
        >
          ←
        </button>
        <div className="text-center">
          <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">{label}</h1>
          {!isToday && (
            <button
              onClick={() => setDay(startOfDay(new Date()))}
              className="text-xs text-accent dark:text-accent-dark"
            >
              Back to today
            </button>
          )}
        </div>
        <button
          aria-label="Next day"
          onClick={() => setDay((d) => addDays(d, 1))}
          className="rounded-control px-2 py-1 text-sm text-text-secondary hover:text-text-primary dark:text-text-secondary-dark"
        >
          →
        </button>
      </div>

      {/* useSearchParams (to read ?googleConnect=.../?microsoftConnect=...
          after each OAuth redirect) requires a Suspense boundary so
          `next build` doesn't de-opt the whole page to client-only
          rendering. */}
      <Suspense fallback={null}>
        <GoogleCalendarConnect refetchQueries={refetchQueries} />
      </Suspense>
      <Suspense fallback={null}>
        <MicrosoftCalendarConnect refetchQueries={refetchQueries} />
      </Suspense>
      {/* No useSearchParams here (Apple's connect flow is a plain form
          submission, not an OAuth redirect), so no Suspense boundary is
          needed for this one, unlike the two above. */}
      <AppleCalendarConnect refetchQueries={refetchQueries} />

      {loading && (
        <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>
      )}

      {error && (
        <p className="mx-4 mb-3 text-sm text-danger dark:text-danger-dark" role="alert">
          Couldn&apos;t load this day. Check that the backend is running.
        </p>
      )}

      {!loading && !error && (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {data?.calendarEventsInRange?.length ? (
            data.calendarEventsInRange.map((event: any) => (
              <CalendarEventRow
                key={event.id}
                id={event.id}
                title={event.title}
                startTime={event.startTime}
                endTime={event.endTime}
                isImmovable={event.isImmovable}
                source={event.source}
                refetchQueries={refetchQueries}
              />
            ))
          ) : (
            <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-5">
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                Nothing on the calendar for this day yet.
              </p>
            </div>
          )}
        </div>
      )}

      <QuickAddEvent day={day} refetchQueries={refetchQueries} />
      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
