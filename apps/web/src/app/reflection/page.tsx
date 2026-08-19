'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  TODAY_REFLECTION_QUERY,
  RECENT_REFLECTIONS_QUERY,
  SUBMIT_DAILY_REFLECTION,
  REFLECTION_LABELS_QUERY,
} from '../../lib/queries';
import { BottomNav } from '../../components/BottomNav';
import { QueryErrorNotice } from '../../components/QueryErrorNotice';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// Configurable daily reflection questions increment — the three classic
// wordings, now only used as the fallback when a person hasn't set their
// own in Settings (`null` on User, same "null means fall back to the fixed
// default" convention every other configurable field in this app uses).
const DEFAULT_WENT_WELL_LABEL = 'What went well today?';
const DEFAULT_CHALLENGING_LABEL = 'What was challenging?';
const DEFAULT_CARRY_FORWARD_LABEL = 'What do you want to carry into tomorrow?';

function ReflectionForm({
  existing,
  wentWellLabel,
  challengingLabel,
  carryForwardLabel,
}: {
  existing?: { wentWell: string; challenging: string; carryForward: string };
  wentWellLabel: string;
  challengingLabel: string;
  carryForwardLabel: string;
}) {
  const [wentWell, setWentWell] = useState(existing?.wentWell ?? '');
  const [challenging, setChallenging] = useState(existing?.challenging ?? '');
  const [carryForward, setCarryForward] = useState(existing?.carryForward ?? '');
  const [error, setError] = useState<string | null>(null);

  const [submit, { loading }] = useMutation(SUBMIT_DAILY_REFLECTION, {
    refetchQueries: [{ query: TODAY_REFLECTION_QUERY }, { query: RECENT_REFLECTIONS_QUERY, variables: { first: 14 } }],
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await submit({ variables: { input: { wentWell, challenging, carryForward } } });
    const errors = result.data?.submitDailyReflection?.errors ?? [];
    if (errors.length > 0) {
      setError(errors[0].message ?? "Couldn't save that reflection. Try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-4 mb-3 flex flex-col gap-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
      <div>
        <label
          htmlFor="reflection-went-well"
          className="mb-1 block text-xs font-medium text-text-secondary dark:text-text-secondary-dark"
        >
          {wentWellLabel}
        </label>
        <textarea
          id="reflection-went-well"
          value={wentWell}
          onChange={(e) => setWentWell(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div>
        <label
          htmlFor="reflection-challenging"
          className="mb-1 block text-xs font-medium text-text-secondary dark:text-text-secondary-dark"
        >
          {challengingLabel}
        </label>
        <textarea
          id="reflection-challenging"
          value={challenging}
          onChange={(e) => setChallenging(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div>
        <label
          htmlFor="reflection-carry-forward"
          className="mb-1 block text-xs font-medium text-text-secondary dark:text-text-secondary-dark"
        >
          {carryForwardLabel}
        </label>
        <textarea
          id="reflection-carry-forward"
          value={carryForward}
          onChange={(e) => setCarryForward(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      {error && <p className="text-xs text-danger dark:text-danger-dark" role="alert">{error}</p>}
      <button
        type="submit"
        disabled={loading || !wentWell.trim() || !challenging.trim() || !carryForward.trim()}
        className="self-end rounded-control bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? 'Saving…' : existing ? 'Update reflection' : 'Save reflection'}
      </button>
    </form>
  );
}

export default function ReflectionPage() {
  const { data, loading, error, refetch } = useQuery(TODAY_REFLECTION_QUERY);
  const { data: recentData } = useQuery(RECENT_REFLECTIONS_QUERY, { variables: { first: 14 } });
  // Configurable daily reflection questions increment — its own small,
  // focused query (see queries.ts's own note on why this isn't folded into
  // SETTINGS_QUERY), fetched alongside the two queries above.
  // Configurable daily reflection questions increment: network-only for the
  // same reason POMODORO_SETTINGS_QUERY on /focus is (see its own comment) —
  // the persisted cache (apollo-client.ts's initCachePersistence) writes to
  // localStorage on a debounce, not synchronously on every mutation, so a
  // full navigation here right after a Settings save can rehydrate a
  // snapshot older than that save. cache-first would then show stale
  // question wording indefinitely instead of the just-saved (or just-
  // cleared) labels.
  const { data: labelsData } = useQuery(REFLECTION_LABELS_QUERY, { fetchPolicy: 'cache-and-network' });
  const [editing, setEditing] = useState(false);

  const today = data?.todayReflection;
  const recent = (recentData?.recentReflections ?? []).filter((r: any) => r.id !== today?.id);

  const wentWellLabel = labelsData?.me?.reflectionWentWellLabel || DEFAULT_WENT_WELL_LABEL;
  const challengingLabel = labelsData?.me?.reflectionChallengingLabel || DEFAULT_CHALLENGING_LABEL;
  const carryForwardLabel = labelsData?.me?.reflectionCarryForwardLabel || DEFAULT_CARRY_FORWARD_LABEL;

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Daily reflection</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Three questions, once a day — a quick end-of-day check-in.
        </p>
      </div>

      {loading && (
        <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>
      )}

      {error && <QueryErrorNotice error={error} what="today's reflection" onRetry={() => refetch()} />}

      {!loading && !error && (
        <>
          {today && !editing ? (
            <div className="mx-4 mb-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
              <p className="mb-2 text-xs text-text-secondary dark:text-text-secondary-dark">
                Saved for today
                {today.aiSummary && ' · summarized below'}
              </p>
              {today.aiSummary && (
                <p className="mb-3 text-sm italic text-text-primary dark:text-text-primary-dark">{today.aiSummary}</p>
              )}
              <div className="flex flex-col gap-2 text-sm text-text-primary dark:text-text-primary-dark">
                <p><span className="text-text-secondary dark:text-text-secondary-dark">Went well: </span>{today.answers.wentWell}</p>
                <p><span className="text-text-secondary dark:text-text-secondary-dark">Challenging: </span>{today.answers.challenging}</p>
                <p><span className="text-text-secondary dark:text-text-secondary-dark">Carrying forward: </span>{today.answers.carryForward}</p>
              </div>
              <button
                onClick={() => setEditing(true)}
                className="mt-3 text-xs text-accent dark:text-accent-dark"
              >
                Edit today&apos;s reflection
              </button>
            </div>
          ) : (
            <ReflectionForm
              existing={editing ? today?.answers : undefined}
              wentWellLabel={wentWellLabel}
              challengingLabel={challengingLabel}
              carryForwardLabel={carryForwardLabel}
            />
          )}

          {recent.length > 0 && (
            <div className="mx-4 mb-3">
              <p className="mb-2 text-xs text-text-secondary dark:text-text-secondary-dark">Past reflections</p>
              <div className="flex flex-col gap-2">
                {recent.map((r: any) => (
                  <div key={r.id} className="rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5">
                    <p className="mb-1 text-xs text-text-secondary dark:text-text-secondary-dark">{formatDate(r.date)}</p>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark">
                      {r.aiSummary ?? r.answers.wentWell}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
