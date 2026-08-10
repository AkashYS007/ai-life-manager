'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { DELETE_CALENDAR_EVENT, UPDATE_CALENDAR_EVENT } from '../lib/queries';
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../lib/datetime-local';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Time-first layout so a day's schedule reads like a real calendar, not a
// task list with timestamps bolted on. `refetchQueries` is passed in by the
// caller so this row works unchanged on both the Today screen (refetches
// TODAY_PLAN_QUERY) and the Calendar day view (refetches the range query).
export function CalendarEventRow({
  id,
  title,
  startTime,
  endTime,
  isImmovable,
  source = 'NATIVE',
  refetchQueries,
}: {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isImmovable: boolean;
  source?: string;
  refetchQueries: any[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Screen-reader pass: this form has two time inputs, so a plain error
  // string alone doesn't tell an assistive-tech user which field it's
  // actually about — this tracks that so aria-describedby (below) can
  // point at the right one(s), rather than leaving a screen-reader user to
  // guess between "Start time" and "End time" on an ordering error.
  const [errorField, setErrorField] = useState<'title' | 'time' | null>(null);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftStart, setDraftStart] = useState(toDatetimeLocalValue(startTime));
  const [draftEnd, setDraftEnd] = useState(toDatetimeLocalValue(endTime));

  const [deleteEvent, { loading: deleting }] = useMutation(DELETE_CALENDAR_EVENT, {
    variables: { id },
    refetchQueries,
  });
  const [updateEvent, { loading: saving }] = useMutation(UPDATE_CALENDAR_EVENT, { refetchQueries });

  // Push-edits-back increment: editing and deleting now push to Google or
  // Microsoft first (whichever a synced event came from) and only apply
  // locally once that succeeds — see CalendarService.update/delete — so
  // both buttons are available for every event regardless of source, same
  // "one control, works everywhere" precedent the original push-deletes
  // increment already set for the Remove button alone. The one way either
  // can still fail is an account connected before its provider's
  // write-scope widened (readonly access from before that point) — that
  // comes back as RECONNECT_REQUIRED rather than a generic failure, so the
  // message can point at the specific provider card to reconnect instead of
  // just "try again."
  const isNative = source === 'NATIVE';
  const providerLabel =
    source === 'MICROSOFT' ? 'Microsoft' : source === 'GOOGLE' ? 'Google' : source === 'APPLE' ? 'Apple' : source;

  function reconnectMessage(action: 'editing' | 'deleting') {
    return `Reconnect ${providerLabel} Calendar above to allow ${action} synced events, then try again.`;
  }

  function resetDraft() {
    setDraftTitle(title);
    setDraftStart(toDatetimeLocalValue(startTime));
    setDraftEnd(toDatetimeLocalValue(endTime));
    setError(null);
    setErrorField(null);
  }

  async function handleSave() {
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      setError('Title is required.');
      setErrorField('title');
      return;
    }
    const newStart = fromDatetimeLocalValue(draftStart);
    const newEnd = fromDatetimeLocalValue(draftEnd);
    if (new Date(newEnd) <= new Date(newStart)) {
      setError('End time must be after the start time.');
      setErrorField('time');
      return;
    }
    setError(null);
    setErrorField(null);
    const result = await updateEvent({
      variables: { id, input: { title: trimmed, startTime: newStart, endTime: newEnd } },
    });
    const errors = result.data?.updateCalendarEvent?.errors ?? [];
    if (errors.length > 0) {
      setError(errors[0].code === 'RECONNECT_REQUIRED' ? reconnectMessage('editing') : errors[0].message ?? "Couldn't save those changes. Try again.");
      setErrorField(null);
      return;
    }
    setIsEditing(false);
  }

  async function handleDelete() {
    setError(null);
    setErrorField(null);
    const result = await deleteEvent();
    const errors = result.data?.deleteCalendarEvent?.errors ?? [];
    if (errors.length === 0) return;
    if (errors[0].code === 'RECONNECT_REQUIRED') {
      setError(reconnectMessage('deleting'));
    } else {
      setError(errors[0].message ?? "Couldn't delete that event. Try again.");
    }
  }

  if (isEditing) {
    return (
      <div
        data-testid={`calendar-event-${id}`}
        className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark px-3 py-3"
      >
        <div className="flex flex-col gap-2">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Event title"
            aria-label="Event title"
            autoFocus
            aria-invalid={errorField === 'title' ? true : undefined}
            aria-describedby={error && errorField === 'title' ? `calendar-event-error-${id}` : undefined}
            className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1.5 text-sm text-text-primary dark:text-text-primary-dark"
          />
          <div className="flex flex-wrap gap-2">
            <input
              type="datetime-local"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
              aria-label={`Start time for "${title}"`}
              aria-invalid={errorField === 'time' ? true : undefined}
              aria-describedby={error && errorField === 'time' ? `calendar-event-error-${id}` : undefined}
              className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-primary dark:text-text-primary-dark"
            />
            <input
              type="datetime-local"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              aria-label={`End time for "${title}"`}
              aria-invalid={errorField === 'time' ? true : undefined}
              aria-describedby={error && errorField === 'time' ? `calendar-event-error-${id}` : undefined}
              className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-primary dark:text-text-primary-dark"
            />
          </div>
          {!isNative && (
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              This will also update the event on {providerLabel} Calendar.
            </p>
          )}
          {error && (
            <p id={`calendar-event-error-${id}`} className="text-xs text-danger dark:text-danger-dark" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              disabled={saving}
              onClick={handleSave}
              className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => {
                setIsEditing(false);
                resetDraft();
              }}
              className="rounded-control border border-border dark:border-border-dark px-3 py-1.5 text-xs font-medium text-text-secondary dark:text-text-secondary-dark"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid={`calendar-event-${id}`} className="rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="w-[92px] shrink-0 text-xs text-text-secondary dark:text-text-secondary-dark">
          {formatTime(startTime)} – {formatTime(endTime)}
        </span>
        <span className="flex-1 text-sm text-text-primary dark:text-text-primary-dark">{title}</span>
        {isImmovable && (
          <span className="text-xs font-medium text-ai-accent dark:text-ai-accent-dark">Fixed</span>
        )}
        {!isNative && (
          <span className="text-xs text-text-secondary dark:text-text-secondary-dark">{providerLabel}</span>
        )}
        <button onClick={() => setIsEditing(true)} className="text-xs font-medium text-accent">
          Edit
        </button>
        <button
          aria-label={`Delete "${title}"`}
          disabled={deleting}
          onClick={handleDelete}
          className="text-xs text-text-secondary hover:text-danger dark:hover:text-danger-dark dark:text-text-secondary-dark disabled:opacity-50"
        >
          Remove
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger dark:text-danger-dark" role="alert">{error}</p>}
    </div>
  );
}
