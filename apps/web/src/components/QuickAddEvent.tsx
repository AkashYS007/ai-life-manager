'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { CREATE_CALENDAR_EVENT } from '../lib/queries';

// Plain, honest event capture (matching QuickAddTask's philosophy): title +
// a start time + a duration in minutes, defaulting to a 30-minute meeting.
// Natural-language time parsing ("lunch with Sam at 1pm") is an AI-layer
// feature for a later increment, not something to fake here.
export function QuickAddEvent({
  day,
  refetchQueries,
}: {
  day: Date;
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
    const start = new Date(day);
    start.setHours(hours, minutes, 0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    await createEvent({
      variables: { title: trimmed, startTime: start.toISOString(), endTime: end.toISOString() },
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
