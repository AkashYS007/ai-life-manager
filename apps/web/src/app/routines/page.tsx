'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { DELETE_ROUTINE, SET_ROUTINE, TODAY_ROUTINES_QUERY } from '../../lib/queries';
import { BottomNav } from '../../components/BottomNav';

interface RoutineStep {
  id: string;
  label: string;
}

interface RoutineData {
  id: string;
  type: 'MORNING' | 'EVENING';
  steps: RoutineStep[];
  aiSequenced: boolean;
}

// Full-replace editor: saving always sends the whole step list (see
// SetRoutineInput's comment) — there's no per-step edit mutation, so this
// form just re-derives a plain string list from the routine and writes it
// back in full on Save, same as the Reflection form's "whole answer set"
// pattern.
function RoutineEditor({ type, existing }: { type: 'MORNING' | 'EVENING'; existing?: RoutineData }) {
  const [steps, setSteps] = useState<string[]>(existing ? existing.steps.map((s) => s.label) : ['']);
  const [aiSequenced, setAiSequenced] = useState(existing?.aiSequenced ?? false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing) {
      setSteps(existing.steps.map((s) => s.label));
      setAiSequenced(existing.aiSequenced);
    }
  }, [existing]);

  const [setRoutine, { loading: saving }] = useMutation(SET_ROUTINE, {
    refetchQueries: [{ query: TODAY_ROUTINES_QUERY }],
  });
  const [deleteRoutine, { loading: deleting }] = useMutation(DELETE_ROUTINE, {
    refetchQueries: [{ query: TODAY_ROUTINES_QUERY }],
  });

  function addStep() {
    const label = draft.trim();
    if (!label) return;
    setSteps((prev) => [...prev, label]);
    setDraft('');
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    setError(null);
    const cleaned = steps.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      setError('Add at least one step.');
      return;
    }
    const result = await setRoutine({ variables: { input: { type, steps: cleaned, aiSequenced } } });
    const errors = result.data?.setRoutine?.errors ?? [];
    if (errors.length > 0) {
      setError(errors[0].message ?? "Couldn't save that routine. Try again.");
    }
  }

  return (
    <div className="mx-4 mb-4 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
      <h2 className="mb-3 text-sm font-medium text-text-primary dark:text-text-primary-dark">
        {type === 'MORNING' ? 'Morning routine' : 'Evening routine'}
      </h2>

      <div className="mb-3 flex flex-col gap-2">
        {steps.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex-1 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-1.5 text-sm text-text-primary dark:text-text-primary-dark">
              {label}
            </span>
            <button
              onClick={() => removeStep(i)}
              aria-label={`Remove "${label}"`}
              className="text-xs text-text-secondary hover:text-danger dark:hover:text-danger-dark dark:text-text-secondary-dark"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addStep();
            }
          }}
          placeholder="Add a step…"
          aria-label="New routine step"
          className="flex-1 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-1.5 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          onClick={addStep}
          className="rounded-control border border-border px-3 py-1.5 text-xs text-text-secondary dark:border-border-dark dark:text-text-secondary-dark"
        >
          Add
        </button>
      </div>

      <label className="mb-3 flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
        <input type="checkbox" checked={aiSequenced} onChange={(e) => setAiSequenced(e.target.checked)} />
        Let AI reorder steps each day around today&apos;s first meeting
      </label>

      {error && <p className="mb-2 text-xs text-danger dark:text-danger-dark" role="alert">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : existing ? 'Update' : 'Create'}
        </button>
        {existing && (
          <button
            onClick={() => deleteRoutine({ variables: { type } })}
            disabled={deleting}
            className="text-xs text-text-secondary hover:text-danger dark:hover:text-danger-dark dark:text-text-secondary-dark"
          >
            {deleting ? 'Removing…' : 'Delete routine'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function RoutinesPage() {
  const { data, loading, error } = useQuery(TODAY_ROUTINES_QUERY);

  const routines: RoutineData[] = data?.todayRoutines ?? [];
  const morning = routines.find((r) => r.type === 'MORNING');
  const evening = routines.find((r) => r.type === 'EVENING');

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Routines</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Set up a checklist for your mornings and evenings — it shows up on Today.
        </p>
      </div>

      {loading && <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>}

      {error && (
        <p className="mx-4 mb-3 text-sm text-danger dark:text-danger-dark" role="alert">
          Couldn&apos;t load your routines. Check that the backend is running.
        </p>
      )}

      {!loading && !error && (
        <>
          <RoutineEditor type="MORNING" existing={morning} />
          <RoutineEditor type="EVENING" existing={evening} />
        </>
      )}

      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
