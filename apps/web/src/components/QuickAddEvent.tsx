'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import type { DateTime } from 'luxon';
import { CREATE_CALENDAR_EVENT } from '../lib/queries';

// Plain, honest event capture (matching QuickAddTask's philosophy): title +
// a start time + a duration in minutes, defaulting to a 30-minute meeting.
// Natural-language time parsing ("lunch with Sam at 1pm") is an AI-layer
// feature for a later increment, not something to fake here.
//
// Bug fix (2026-08-14): this used to take a plain `Date` and call
// `setHours()` on it, which sets the hour in the *browser's* local zone.
// Combined with the CalendarPage bug fixed alongside this one, a "9:00 AM"
// event typed here could land on the wrong side of a day boundary in the
// account's actual (stored) timezone. `zonedDay` is a Luxon `DateTime`
// already anchored to that stored zone (see CalendarPage), so setting the
// hour/minute on it via Luxon's `.set()` keeps the whole day-bucketing
// story consistent instead of quietly reintroducing the same class of bug
// one component over.
export function QuickAddEvent({
  zonedDay,
  refetchQueries,
}: {
  zonedDay: DateTime;
  refetchQueries: any[];
}) {
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [createEvent, { loading, error }] = useMutation(CREATE_CALENDAR_EVENT, { refetchQueries });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    const [hours, minutes] = time.split(':').map(Number);
    const start = zonedDay.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
    const end = start.plus({ minutes: durationMinutes });

    await createEvent({
      variables: { title: trimmed, startTime: start.toUTC().toISO(), endTime: end.toUTC().toISO() },
    });
    setTitle('');
  }

  return (
    <form onSubmit={handleSubmit} className="mx-4 mb-2 flex flex-wrap gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add an event…"
        aria-label="Event title"
        disabled={loading}
        className="flex-1 min-w-[140px] rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        aria-label="Start time"
        disabled={loading}
        className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-2 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <select
        value={durationMinutes}
        onChange={(e) => setDurationMinutes(Number(e.target.value))}
        aria-label="Duration"
        disabled={loading}
        className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-2 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value={15}>15m</option>
        <option value={30}>30m</option>
        <option value={60}>1h</option>
        <option value={120}>2h</option>
      </select>
      <button
        type="submit"
        disabled={loading || !title.trim()}
        className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Add
      </button>
      {error && <p className="w-full text-xs text-danger dark:text-danger-dark" role="alert">Couldn&apos;t add that event. Try again.</p>}
    </form>
  );
}
