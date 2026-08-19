'use client';

import { Suspense, useState } from 'react';
import { useQuery } from '@apollo/client';
import { DateTime } from 'luxon';
import { CALENDAR_EVENTS_IN_RANGE, TODAY_PLAN_QUERY, ME_TIMEZONE_QUERY } from '../../lib/queries';
import { CalendarEventRow } from '../../components/CalendarEventRow';
import { QuickAddEvent } from '../../components/QuickAddEvent';
import { GoogleCalendarConnect } from '../../components/GoogleCalendarConnect';
import { MicrosoftCalendarConnect } from '../../components/MicrosoftCalendarConnect';
import { AppleCalendarConnect } from '../../components/AppleCalendarConnect';
import { BottomNav } from '../../components/BottomNav';
import { QueryErrorNotice } from '../../components/QueryErrorNotice';

// Timezone-correctness fix (found via live testing, 2026-08-14): this page
// used to compute "today" with plain `Date` + `setHours(0,0,0,0)`, i.e.
// midnight in the *browser's* local zone. The backend's `todayPlan` query
// buckets events into "today" using `zonedDayBounds(date, user.timezone)`
// instead (see apps/backend/src/common/date/zoned-day.ts) — the *stored*,
// server-trusted IANA zone, computed with Luxon so DST transitions aren't
// hand-rolled. Those two windows only coincide when the browser's live zone
// happens to match the account's stored zone exactly; reading the same
// `user.timezone` here (already fetched elsewhere via ME_TIMEZONE_QUERY,
// e.g. TimezoneSync) and bucketing with Luxon makes the two screens agree
// by construction instead of by coincidence, and keeps this page correct
// for a browser whose live zone has drifted from the account's stored one.
//
// This alone did NOT explain the actual bug that live testing caught,
// though (a real event showing on /today but /calendar reporting "Nothing
// on the calendar for this day yet" for the same date) — both zones were
// already "America/Los_Angeles" here, so the two windows always matched.
// The real cause was a stale `apollo-cache-persist` entry in localStorage
// (see the `fetchPolicy` on the query below) serving a cached-empty result
// for this exact query indefinitely; this timezone fix is kept anyway
// because it's still a real correctness gap for any account whose stored
// zone and current browser zone diverge (a new device, a `user.timezone`
// that hasn't been synced yet, etc.), just not the one that was reproduced.
function detectedZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Day view — a week/month grid is a natural follow-up once this is proven
// out, matching how Tasks shipped list-only before any board/grouped view.
export default function CalendarPage() {
  const { data: meData } = useQuery(ME_TIMEZONE_QUERY, { errorPolicy: 'ignore' });
  const timezone = meData?.me?.timezone || detectedZone();

  // Stored as an offset in days from "today", not an absolute Date/DateTime.
  // Recomputing `rangeStart` from `timezone` on every render (below) means
  // that if `timezone` changes — e.g. the detected-zone fallback above gets
  // replaced by the real `me.timezone` once ME_TIMEZONE_QUERY resolves —
  // the viewed day is still correctly anchored to "today" in that zone
  // rather than frozen at whatever zone was active when a `useState`
  // initializer last ran.
  const [dayOffset, setDayOffset] = useState(0);

  const rangeStart = DateTime.now().setZone(timezone).startOf('day').plus({ days: dayOffset });
  const rangeEnd = rangeStart.plus({ days: 1 });

  const rangeVariables = { start: rangeStart.toUTC().toISO(), end: rangeEnd.toUTC().toISO() };
  // Root-cause fix (2026-08-14): default `fetchPolicy` is 'cache-first', and
  // this app persists the Apollo cache to localStorage for offline support
  // (see lib/apollo-client.ts's `initCachePersistence`). Those two combine
  // badly for a query like this one whose correct answer changes over time
  // (new events get added/synced) but whose *variables* stay identical
  // every time you view the same calendar day — 'cache-first' was finding
  // that old cache entry, trusting it completely, and never asking the
  // network again, so a day that was genuinely empty the first time it was
  // ever viewed stayed looking empty forever after, even once real events
  // existed for it. 'cache-and-network' keeps the instant-paint-from-cache
  // behavior offline support needs, but always fires the network request
  // too and re-renders when that resolves — so a stale cache entry only
  // ever lasts one render instead of indefinitely.
  const { data, loading, error, refetch } = useQuery(CALENDAR_EVENTS_IN_RANGE, {
    variables: rangeVariables,
    fetchPolicy: 'cache-and-network',
  });

  const refetchQueries = [
    { query: CALENDAR_EVENTS_IN_RANGE, variables: rangeVariables },
    { query: TODAY_PLAN_QUERY },
  ];

  const label = rangeStart.toJSDate().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const isToday = dayOffset === 0;

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="flex items-center justify-between px-5 pt-6 pb-3">
        <button
          aria-label="Previous day"
          onClick={() => setDayOffset((o) => o - 1)}
          className="rounded-control px-2 py-1 text-sm text-text-secondary hover:text-text-primary dark:text-text-secondary-dark"
        >
          ←
        </button>
        <div className="text-center">
          <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">{label}</h1>
          {!isToday && (
            <button
              onClick={() => setDayOffset(0)}
              className="text-xs text-accent dark:text-accent-dark"
            >
              Back to today
            </button>
          )}
        </div>
        <button
          aria-label="Next day"
          onClick={() => setDayOffset((o) => o + 1)}
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

      {error && <QueryErrorNotice error={error} what="this day" onRetry={() => refetch()} />}

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

      <QuickAddEvent zonedDay={rangeStart} refetchQueries={refetchQueries} />
      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
