'use client';

import { useMutation } from '@apollo/client';
import { SET_TODAY_ROUTINE_COMPLETION, TODAY_ROUTINES_QUERY } from '../lib/queries';

interface RoutineStep {
  id: string;
  label: string;
}

// Same checkbox-first layout as HabitRow, but each tap sends the *whole*
// completed-ids array (SetTodayRoutineCompletionInput's full-replace
// semantics — see that DTO's comment) rather than a per-step toggle
// mutation, since a routine's steps aren't individually addressable rows
// the way HabitLog's are.
export function RoutineChecklist({
  id,
  type,
  steps,
  aiSequenced,
  completedStepIds,
}: {
  id: string;
  type: 'MORNING' | 'EVENING';
  steps: RoutineStep[];
  aiSequenced: boolean;
  completedStepIds: string[];
}) {
  const [setCompletion, { loading }] = useMutation(SET_TODAY_ROUTINE_COMPLETION, {
    refetchQueries: [{ query: TODAY_ROUTINES_QUERY }],
  });

  function toggle(stepId: string) {
    const next = completedStepIds.includes(stepId)
      ? completedStepIds.filter((sid) => sid !== stepId)
      : [...completedStepIds, stepId];
    setCompletion({ variables: { input: { type, completedStepIds: next } } });
  }

  const doneCount = steps.filter((s) => completedStepIds.includes(s.id)).length;

  return (
    <div className="mx-4 mb-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-text-secondary dark:text-text-secondary-dark">
          {type === 'MORNING' ? 'Morning routine' : 'Evening routine'}
          {aiSequenced && ' · AI-ordered'}
        </p>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          {doneCount}/{steps.length}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {steps.map((step) => {
          const done = completedStepIds.includes(step.id);
          return (
            <div key={step.id} className="flex items-center gap-3">
              <button
                type="button"
                aria-label={done ? `Mark "${step.label}" not done` : `Mark "${step.label}" done`}
                aria-pressed={done}
                disabled={loading}
                onClick={() => toggle(step.id)}
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 text-[11px] leading-none text-white disabled:opacity-50 ${
                  done
                    ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
                    : 'border-text-secondary dark:border-text-secondary-dark'
                }`}
              >
                {done ? '✓' : ''}
              </button>
              <span
                className={`flex-1 text-sm ${
                  done
                    ? 'text-text-secondary line-through dark:text-text-secondary-dark'
                    : 'text-text-primary dark:text-text-primary-dark'
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
