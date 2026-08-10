'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { CANCEL_TASK, CANCELLED_TASKS_QUERY, CREATE_TAG, OPEN_TASKS_QUERY, TODAY_PLAN_QUERY, UPDATE_TASK } from '../lib/queries';
import { SubtaskList } from './SubtaskList';

interface TaskListItem {
  id: string;
  title: string;
  description?: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  priority: number;
  dueDate?: string | null;
  estimatedDurationMinutes?: number | null;
  goal?: { id: string; title: string } | null;
  tags: { id: string; name: string; color?: string | null }[];
  subtasks: { id: string; title: string; status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' }[];
}

interface GoalOption {
  id: string;
  title: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
}

function dueDateToInputValue(iso?: string | null) {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}

// Tasks list/edit screen increment: the full editor a task has never had
// anywhere in the app until now — title, description, priority, due date,
// duration, goal link, and tags, all in one inline form. Unlike
// AiPlanCard's narrower "Edit task" control (title/priority/duration only,
// scoped to what a plan change cares about), this is the general-purpose
// editor, reachable from the new `/tasks` page rather than a plan review
// row.
export function TaskEditRow({ task, goals }: { task: TaskListItem; goals: GoalOption[] }) {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [dueDate, setDueDate] = useState(dueDateToInputValue(task.dueDate));
  const [duration, setDuration] = useState(task.estimatedDurationMinutes?.toString() ?? '');
  const [goalId, setGoalId] = useState(task.goal?.id ?? '');
  const [tagsText, setTagsText] = useState(task.tags.map((t) => t.name).join(', '));

  // Tasks pagination increment: refetches both tabs' queries (no
  // variables — same "just re-run page one" tradeoff /more's own Undo
  // button already accepts for COMPLETED_TASKS_QUERY) rather than just the
  // tab this row happens to currently be shown in, since cancelling a task
  // moves it from Open to Cancelled — the other tab's list needs to know
  // too, not just this one.
  const refetchQueries = [{ query: OPEN_TASKS_QUERY }, { query: CANCELLED_TASKS_QUERY }, { query: TODAY_PLAN_QUERY }];
  const [updateTask, { loading: saving }] = useMutation(UPDATE_TASK, { refetchQueries });
  const [cancelTask, { loading: cancelling }] = useMutation(CANCEL_TASK, { refetchQueries });
  const [createTag] = useMutation(CREATE_TAG);

  function resetDraft() {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setPriority(task.priority);
    setDueDate(dueDateToInputValue(task.dueDate));
    setDuration(task.estimatedDurationMinutes?.toString() ?? '');
    setGoalId(task.goal?.id ?? '');
    setTagsText(task.tags.map((t) => t.name).join(', '));
    setError(null);
  }

  async function handleSave() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required.');
      return;
    }
    setError(null);

    // Resolve each typed tag name to a real id. createTag upserts by name
    // (see CREATE_TAG's own comment), so this is safe to call for a tag
    // that already exists — it just returns that same tag, never a
    // duplicate.
    const tagNames = [...new Set(tagsText.split(',').map((t) => t.trim()).filter(Boolean))];
    const tagIds: string[] = [];
    for (const name of tagNames) {
      const result = await createTag({ variables: { input: { name } } });
      const tagPayload = result.data?.createTag;
      if (tagPayload?.errors?.length) {
        setError(tagPayload.errors[0].message);
        return;
      }
      if (tagPayload?.tag?.id) tagIds.push(tagPayload.tag.id);
    }

    const result = await updateTask({
      variables: {
        id: task.id,
        input: {
          title: trimmedTitle,
          description: description.trim() || null,
          priority,
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
          estimatedDurationMinutes: duration.trim() ? parseInt(duration, 10) : null,
          goalId: goalId || null,
          tagIds,
        },
      },
    });
    const payload = result.data?.updateTask;
    if (payload?.errors?.length) {
      setError(payload.errors[0].message);
      return;
    }
    setIsEditing(false);
  }

  async function handleCancelTask() {
    const result = await cancelTask({ variables: { id: task.id } });
    const payload = result.data?.cancelTask;
    if (payload?.errors?.length) {
      setError(payload.errors[0].message);
    }
  }

  if (!isEditing) {
    return (
      <div data-testid={`task-row-${task.id}`} className="rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="text-sm text-text-primary dark:text-text-primary-dark">{task.title}</p>
            {task.goal && <p className="text-xs text-ai-accent dark:text-ai-accent-dark">{task.goal.title}</p>}
            {task.description && (
              <p className="mt-0.5 text-xs text-text-secondary dark:text-text-secondary-dark">{task.description}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              {task.priority === 1 && <span className="font-medium text-danger dark:text-danger-dark">Urgent</span>}
              {task.estimatedDurationMinutes != null && <span>~{task.estimatedDurationMinutes}m</span>}
              {task.dueDate && <span>Due {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
              {task.tags.map((t) => (
                <span key={t.id} className="rounded-control border border-border px-1.5 py-0.5 dark:border-border-dark">
                  {t.name}
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => setIsEditing(true)} className="text-xs font-medium text-accent">
              Edit
            </button>
            {task.status !== 'CANCELLED' && (
              <button
                disabled={cancelling}
                onClick={handleCancelTask}
                className="text-xs font-medium text-text-secondary hover:text-danger dark:hover:text-danger-dark dark:text-text-secondary-dark disabled:opacity-50"
              >
                {cancelling ? '…' : 'Cancel'}
              </button>
            )}
          </div>
        </div>
        {error && <p className="mt-1 text-xs text-danger dark:text-danger-dark" role="alert">{error}</p>}

        <SubtaskList
          parentTaskId={task.id}
          parentTitle={task.title}
          subtasks={task.subtasks}
          canAdd={task.status !== 'CANCELLED'}
        />
      </div>
    );
  }

  return (
    <div
      data-testid={`task-row-${task.id}`}
      className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark px-3 py-3"
    >
      <div className="flex flex-col gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          aria-label="Task title"
          // Screen-reader pass: the only validation error this form can
          // produce ("Title is required.") is always about this field, so
          // it's the one wired to the error paragraph's id below — moving
          // focus into this field on entering edit mode (autoFocus, same
          // precedent as MemoryFactRow/NewGoalForm) also means a
          // screen-reader user lands right where the form actually starts,
          // not wherever the "Edit" button happened to be.
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `task-edit-error-${task.id}` : undefined}
          className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1.5 text-sm text-text-primary dark:text-text-primary-dark"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          aria-label="Description"
          rows={2}
          className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1.5 text-sm text-text-primary dark:text-text-primary-dark"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value, 10))}
            aria-label="Priority"
            className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-primary dark:text-text-primary-dark"
          >
            <option value={1}>Priority: Urgent</option>
            <option value={2}>Priority: High</option>
            <option value={3}>Priority: Normal</option>
            <option value={4}>Priority: Someday</option>
          </select>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-label="Due date"
            className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-primary dark:text-text-primary-dark"
          />
          <input
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="min"
            aria-label="Estimated duration in minutes"
            className="w-20 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-primary dark:text-text-primary-dark"
          />
        </div>
        <select
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
          aria-label="Link to goal"
          className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-primary dark:text-text-primary-dark"
        >
          <option value="">No goal</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
              {g.status !== 'ACTIVE' ? ` (${g.status.toLowerCase()})` : ''}
            </option>
          ))}
        </select>
        <input
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="Tags, comma separated"
          aria-label="Tags, comma separated"
          className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1.5 text-xs text-text-primary dark:text-text-primary-dark"
        />
        {error && (
          <p id={`task-edit-error-${task.id}`} className="text-xs text-danger dark:text-danger-dark" role="alert">
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
