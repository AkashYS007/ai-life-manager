'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@apollo/client';
import {
  ACT_ON_RECOMMENDATION,
  DISMISS_RECOMMENDATION,
  GENERATE_RECOMMENDATIONS,
  TODAY_PLAN_QUERY,
  TODAY_RECOMMENDATIONS_QUERY,
} from '../lib/queries';
import { fromDatetimeLocalValue, toDatetimeLocalValue } from '../lib/datetime-local';

interface Recommendation {
  id: string;
  category: 'BREAK' | 'WORKOUT' | 'MEAL';
  message: string;
  dismissed: boolean;
}

const CATEGORY_LABEL: Record<Recommendation['category'], string> = {
  BREAK: 'Break',
  WORKOUT: 'Workout',
  MEAL: 'Meal',
};

// AI recommendations acting on your behalf increment: what one tap of the
// action button below actually does, per category — a real 15-minute break
// timer for BREAK, a real 30-minute calendar block starting right now for
// WORKOUT (see the Booking a workout as a real calendar block increment),
// or a real open task titled with the suggestion's own message for MEAL,
// since it's still the one category with no domain of its own in this app.
// These stay the real defaults this button commits with — the Customize
// act-on defaults increment adds a way to override them first, never
// changes what a plain tap on this button itself does.
const ACTION_LABEL: Record<Recommendation['category'], string> = {
  BREAK: 'Take this break',
  WORKOUT: 'Book this workout',
  MEAL: 'Add as a task',
};

const PRIORITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'Priority: Urgent' },
  { value: '2', label: 'Priority: High' },
  { value: '3', label: 'Priority: Normal' },
  { value: '4', label: 'Priority: Someday' },
];

// PRD §7.4's "AI recommendations (breaks, workouts, meals)". Dismissing
// still just hides a suggestion, never changing real data — same
// propose-only spirit AiPlanCard's Accept/Reject flow established. The
// action button below is the one deliberate exception to that spirit (see
// its own comment): a real, one-tap committed action, not a second
// "navigate and confirm" step. Same "generating replaces the whole set"
// semantics as SetRoutineInput, so a visible **Refresh** always means a
// clean new set of 1-3 suggestions.
export function AiRecommendationsCard({
  recommendationRun,
}: {
  recommendationRun?: { id: string; recommendations: Recommendation[] } | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const refetchQueries = [{ query: TODAY_RECOMMENDATIONS_QUERY }];
  const actRefetchQueries = [...refetchQueries, { query: TODAY_PLAN_QUERY }];

  const [generate, { loading: generating }] = useMutation(GENERATE_RECOMMENDATIONS, { refetchQueries });
  const [dismiss] = useMutation(DISMISS_RECOMMENDATION, { refetchQueries });
  const [actOn, { loading: acting }] = useMutation(ACT_ON_RECOMMENDATION, { refetchQueries: actRefetchQueries });

  // Customize act-on defaults at the point of acting increment: only one
  // recommendation's customize panel is ever open at a time (flat draft
  // state, not keyed per-row) — deliberately simple, since acting on one
  // suggestion always dismisses it, so there's never a real need to keep
  // two panels' drafts alive simultaneously. `customizingId` doubles as
  // both "which panel is open" and "which recommendation these draft
  // values belong to."
  const [customizingId, setCustomizingId] = useState<string | null>(null);
  const [draftDurationMinutes, setDraftDurationMinutes] = useState('');
  const [draftStartTime, setDraftStartTime] = useState('');
  const [draftPriority, setDraftPriority] = useState('3');
  const [draftDueDate, setDraftDueDate] = useState('');

  function closeCustomize() {
    setCustomizingId(null);
    setDraftDurationMinutes('');
    setDraftStartTime('');
    setDraftPriority('3');
    setDraftDueDate('');
  }

  function toggleCustomize(rec: Recommendation) {
    setError(null);
    if (customizingId === rec.id) {
      closeCustomize();
      return;
    }
    setCustomizingId(rec.id);
    setDraftDurationMinutes('');
    // Pre-filled to "right now" — the exact same default the WORKOUT path
    // already uses when this field is left alone, so opening the panel and
    // immediately confirming without touching anything behaves identically
    // to never having opened it at all.
    setDraftStartTime(toDatetimeLocalValue(new Date().toISOString()));
    setDraftPriority('3');
    setDraftDueDate('');
  }

  async function handleGenerate() {
    setError(null);
    const result = await generate();
    const errors = result.data?.generateRecommendations?.errors ?? [];
    if (errors.length > 0) {
      setError(errors[0].message);
    }
  }

  // `customInput` is only ever passed from the customize panel's own
  // Confirm button below — the main action button always calls this with
  // no second argument, so `input: undefined` goes to the server and every
  // field falls back to its fixed default exactly as it always has.
  async function handleAct(rec: Recommendation, customInput?: Record<string, unknown>) {
    setError(null);
    setConfirmation(null);
    const result = await actOn({ variables: { id: rec.id, input: customInput ?? null } });
    const payload = result.data?.actOnRecommendation;
    const errors = payload?.errors ?? [];
    if (errors.length > 0) {
      setError(errors[0].message);
      return;
    }
    closeCustomize();
    if (payload?.startedFocusSessionId) {
      // The mutation already committed the real action (a real IN_PROGRESS
      // FocusSession row exists now) — this navigation is purely so the
      // person can see the countdown they just started, not a second
      // confirmation step.
      router.push('/focus');
    } else if (payload?.bookedCalendarEventId) {
      // Same "already committed, just go look at it" reasoning as BREAK
      // above — a real CalendarEvent row already exists by the time this
      // runs, so navigating to /calendar shows the block that's actually
      // there now, not a preview of one about to be created.
      router.push('/calendar');
    } else if (payload?.createdTaskId) {
      setConfirmation("Added to today's tasks — see it in your list below.");
    }
  }

  function handleConfirmCustom(rec: Recommendation) {
    const input: Record<string, unknown> = {};
    if (rec.category === 'MEAL') {
      if (draftPriority) input.priority = parseInt(draftPriority, 10);
      if (draftDueDate) input.dueDate = new Date(draftDueDate).toISOString();
    } else {
      if (draftDurationMinutes.trim()) input.durationMinutes = parseInt(draftDurationMinutes, 10);
      if (rec.category === 'WORKOUT' && draftStartTime) input.startTime = fromDatetimeLocalValue(draftStartTime);
    }
    handleAct(rec, input);
  }

  const visible = (recommendationRun?.recommendations ?? []).filter((r) => !r.dismissed);

  return (
    <div className="mx-4 mb-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
      {error && (
        <p
          data-testid="recommendations-error"
          className="mb-2 text-xs text-danger dark:text-danger-dark"
          role="alert"
        >
          {error}
        </p>
      )}
      {confirmation && (
        <p className="mb-2 text-xs text-accent dark:text-accent-dark" role="status">{confirmation}</p>
      )}

      {visible.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text-primary dark:text-text-primary-dark">Recommendations</h2>
            <button
              disabled={generating}
              onClick={handleGenerate}
              className="text-xs text-text-secondary hover:text-ai-accent disabled:opacity-50 dark:text-text-secondary-dark"
            >
              {generating ? 'Thinking…' : 'Refresh'}
            </button>
          </div>
          {visible.map((rec) => (
            <div key={rec.id} className="rounded-control bg-background dark:bg-background-dark px-3 py-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded-control bg-ai-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ai-accent">
                  {CATEGORY_LABEL[rec.category]}
                </span>
                <span className="flex-1 text-sm text-text-primary dark:text-text-primary-dark">{rec.message}</span>
                <button
                  disabled={acting}
                  onClick={() => handleAct(rec)}
                  className="shrink-0 rounded-control bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {acting && customizingId !== rec.id ? '…' : ACTION_LABEL[rec.category]}
                </button>
                <button
                  aria-label="Dismiss"
                  disabled={acting}
                  onClick={() => dismiss({ variables: { id: rec.id } })}
                  className="shrink-0 text-xs text-text-secondary hover:text-text-primary dark:text-text-secondary-dark disabled:opacity-50"
                >
                  ×
                </button>
              </div>

              <button
                type="button"
                disabled={acting}
                onClick={() => toggleCustomize(rec)}
                className="mt-1 text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark disabled:opacity-50"
              >
                {customizingId === rec.id ? 'Cancel customize' : 'Customize →'}
              </button>

              {/* Customize act-on defaults at the point of acting increment —
                  closes "no way to customize the break length, block
                  length/time, or task fields at the point of acting" from
                  the README's own "not built yet" list. Deliberately a
                  disclosure below the main row, not a replacement for it —
                  the one-tap button above still commits with the fixed
                  defaults exactly as it always has; this is purely an
                  optional detour for the one time in three someone actually
                  wants a different number. */}
              {customizingId === rec.id && (
                <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-border dark:border-border-dark pt-2">
                  {rec.category === 'MEAL' ? (
                    <>
                      <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
                        Priority
                        <select
                          value={draftPriority}
                          onChange={(e) => setDraftPriority(e.target.value)}
                          aria-label="Custom task priority"
                          className="ml-2 rounded-control border border-border dark:border-border-dark bg-surface dark:bg-surface-dark px-2 py-1 text-xs text-text-primary dark:text-text-primary-dark"
                        >
                          {PRIORITY_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
                        Due date
                        <input
                          type="date"
                          value={draftDueDate}
                          onChange={(e) => setDraftDueDate(e.target.value)}
                          aria-label="Custom task due date"
                          className="ml-2 rounded-control border border-border dark:border-border-dark bg-surface dark:bg-surface-dark px-2 py-1 text-xs text-text-primary dark:text-text-primary-dark"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
                        {rec.category === 'BREAK' ? 'Break length' : 'Block length'}
                        <input
                          type="number"
                          min={1}
                          max={180}
                          value={draftDurationMinutes}
                          onChange={(e) => setDraftDurationMinutes(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder={rec.category === 'BREAK' ? '15' : '30'}
                          aria-label={rec.category === 'BREAK' ? 'Custom break minutes' : 'Custom workout block minutes'}
                          className="ml-2 w-16 rounded-control border border-border dark:border-border-dark bg-surface dark:bg-surface-dark px-2 py-1 text-xs text-text-primary dark:text-text-primary-dark"
                        />
                        <span className="ml-1">min</span>
                      </label>
                      {rec.category === 'WORKOUT' && (
                        <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
                          Start
                          <input
                            type="datetime-local"
                            value={draftStartTime}
                            onChange={(e) => setDraftStartTime(e.target.value)}
                            aria-label="Custom workout start time"
                            className="ml-2 rounded-control border border-border dark:border-border-dark bg-surface dark:bg-surface-dark px-2 py-1 text-xs text-text-primary dark:text-text-primary-dark"
                          />
                        </label>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => handleConfirmCustom(rec)}
                    className="rounded-control bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {acting && customizingId === rec.id ? '…' : `Confirm & ${ACTION_LABEL[rec.category].toLowerCase()}`}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Let AI suggest a break, a workout, or a meal based on how your day&apos;s going.
          </p>
          <button
            disabled={generating}
            onClick={handleGenerate}
            className="shrink-0 rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {generating ? 'Thinking…' : 'Get recommendations'}
          </button>
        </div>
      )}
    </div>
  );
}
