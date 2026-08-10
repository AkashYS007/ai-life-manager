'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { CANCEL_TASK, CANCELLED_TASKS_QUERY, COMPLETE_TASK, CREATE_SUBTASK, OPEN_TASKS_QUERY, REOPEN_TASK, TODAY_PLAN_QUERY } from '../lib/queries';

interface Subtask {
  id: string;
  title: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

// Subtask UI increment: Task.subtasks/parentTaskId have been real, working
// Prisma columns and a real GraphQL field (see tasks.service.ts's
// TASK_INCLUDE and task.model.ts's `subtasks` field) since the very first
// Tasks increment — this is the first screen anywhere in the app that
// actually surfaces them. Deliberately simpler than a top-level task's own
// row in two ways: completing one skips TaskRow's "how long did this
// actually take?" prompt (that flow protects the AI duration-accuracy
// learning signal specifically — see task_duration_accuracy in the
// Automatic AI Memory learning section — a subtask is a lightweight
// checklist item, not something that signal needs to track), and "Remove"
// is really `cancelTask` under a friendlier label, the same "no hard delete
// for a task, ever" rule every other task action in this app already
// follows. A cancelled/removed subtask is filtered out of view entirely
// rather than shown crossed-out — there's no "undo a removal" UI for
// subtasks, so showing it would just be confusing dead weight.
export function SubtaskList({
  parentTaskId,
  parentTitle,
  subtasks,
  canAdd = true,
}: {
  parentTaskId: string;
  parentTitle: string;
  subtasks: Subtask[];
  canAdd?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Tasks pagination increment: refetches both tabs' queries, same
  // reasoning as TaskEditRow's own refetchQueries — a subtask's own parent
  // is always visible in whichever tab is currently open, but keeping both
  // in sync costs nothing and avoids a subtle staleness bug if the parent
  // task itself ever gets cancelled from elsewhere in the same session.
  const refetchQueries = [{ query: OPEN_TASKS_QUERY }, { query: CANCELLED_TASKS_QUERY }, { query: TODAY_PLAN_QUERY }];
  const [createSubtask, { loading: adding }] = useMutation(CREATE_SUBTASK, { refetchQueries });
  const [completeTask, { loading: completing }] = useMutation(COMPLETE_TASK, { refetchQueries });
  const [reopenTask, { loading: reopening }] = useMutation(REOPEN_TASK, { refetchQueries });
  const [cancelTask, { loading: cancelling }] = useMutation(CANCEL_TASK, { refetchQueries });

  const visible = subtasks.filter((s) => s.status !== 'CANCELLED');
  const doneCount = visible.filter((s) => s.status === 'COMPLETED').length;
  const busy = adding || completing || reopening || cancelling;

  async function handleAdd() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setError(null);
    const result = await createSubtask({ variables: { title: trimmed, parentTaskId } });
    const payload = result.data?.createTask;
    if (payload?.errors?.length) {
      setError(payload.errors[0].message ?? "Couldn't add that subtask. Try again.");
      return;
    }
    setDraft('');
  }

  async function toggle(subtask: Subtask) {
    setError(null);
    const result =
      subtask.status === 'COMPLETED'
        ? await reopenTask({ variables: { id: subtask.id } })
        : await completeTask({ variables: { id: subtask.id } });
    const payload = result.data?.reopenTask ?? result.data?.completeTask;
    if (payload?.errors?.length) {
      setError(payload.errors[0].message ?? "Couldn't update that subtask. Try again.");
    }
  }

  async function remove(subtaskId: string) {
    setError(null);
    const result = await cancelTask({ variables: { id: subtaskId } });
    const payload = result.data?.cancelTask;
    if (payload?.errors?.length) {
      setError(payload.errors[0].message ?? "Couldn't remove that subtask. Try again.");
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-border dark:border-border-dark pt-2">
      <div className="flex items-center justify-between">
        {/* A plain label, not a heading — this repeats once per task row in
            a list, and a heading here would create a skipped h1→h3 level
            with no page-section h2 in between (Tasks/Today's own <h1> is
            the only real heading above this), the same "don't add a
            heading everywhere text is emphasized" restraint the
            accessibility pass's own heading-structure work already used
            (see "Recent sessions" on /focus for the same pattern). */}
        <p className="text-xs font-medium text-text-secondary dark:text-text-secondary-dark">Subtasks</p>
        {visible.length > 0 && (
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {doneCount}/{visible.length}
          </p>
        )}
      </div>

      {visible.map((s) => {
        const done = s.status === 'COMPLETED';
        return (
          <div key={s.id} className="flex items-center gap-2">
            <button
              type="button"
              aria-label={done ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}
              aria-pressed={done}
              disabled={busy}
              onClick={() => toggle(s)}
              className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] border-2 text-[10px] leading-none text-white disabled:opacity-50 ${
                done
                  ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
                  : 'border-text-secondary dark:border-text-secondary-dark'
              }`}
            >
              {done ? '✓' : ''}
            </button>
            <span
              className={`flex-1 text-xs ${
                done
                  ? 'text-text-secondary line-through dark:text-text-secondary-dark'
                  : 'text-text-primary dark:text-text-primary-dark'
              }`}
            >
              {s.title}
            </span>
            <button
              aria-label={`Remove subtask "${s.title}"`}
              disabled={busy}
              onClick={() => remove(s.id)}
              className="text-xs text-text-secondary hover:text-danger dark:hover:text-danger-dark dark:text-text-secondary-dark disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        );
      })}

      {error && (
        <p id={`subtask-error-${parentTaskId}`} className="text-xs text-danger dark:text-danger-dark" role="alert">
          {error}
        </p>
      )}

      {canAdd && (
        <div className="mt-1 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Add a subtask…"
            aria-label={`Add a subtask to "${parentTitle}"`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `subtask-error-${parentTaskId}` : undefined}
            disabled={adding}
            className="flex-1 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !draft.trim()}
            className="rounded-control border border-border px-2 py-1 text-xs text-text-secondary dark:border-border-dark dark:text-text-secondary-dark disabled:opacity-50"
          >
            {adding ? '…' : 'Add'}
          </button>
        </div>
      )}
    </div>
  );
}
