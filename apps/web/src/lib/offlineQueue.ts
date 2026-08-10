'use client';

import { apolloClient } from './apollo-client';
import { CREATE_TASK, COMPLETE_TASK, CREATE_JOURNAL_ENTRY, TODAY_PLAN_QUERY, JOURNAL_ENTRIES_QUERY } from './queries';

// PWA + offline support increment: the PRD is specific that "adding/
// completing tasks, and journaling must work with no connection and sync
// on reconnect" — this module is the whole mechanism behind that for
// exactly those three actions (not a generic offline-everything layer,
// matching this project's "narrow, purpose-built solution" precedent).
// Three parts: a small persisted queue of mutations that couldn't reach
// the server yet, a set of hand-written optimistic cache patches (one per
// action) so the person sees their change take effect immediately instead
// of staring at a spinner or a hard failure, and a flush routine that
// replays the queue in order once a connection is back.

const QUEUE_KEY = 'ailm_offline_queue';
const SYNC_ERRORS_KEY = 'ailm_offline_sync_errors';
const QUEUE_CHANGED_EVENT = 'ailm-offline-queue-changed';
export const OFFLINE_QUEUE_CHANGED_EVENT = QUEUE_CHANGED_EVENT;

export type QueuedMutationKind = 'createTask' | 'completeTask' | 'createJournalEntry';

export interface QueuedMutation {
  id: string;
  kind: QueuedMutationKind;
  variables: Record<string, unknown>;
  createdAt: string;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function readQueue(): QueuedMutation[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedMutation[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

export function getQueue(): QueuedMutation[] {
  return readQueue();
}

function removeFromQueue(id: string) {
  writeQueue(readQueue().filter((item) => item.id !== id));
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

export function enqueue(kind: QueuedMutationKind, variables: Record<string, unknown>): QueuedMutation {
  const item: QueuedMutation = { id: newId(), kind, variables, createdAt: new Date().toISOString() };
  const queue = readQueue();
  queue.push(item);
  writeQueue(queue);
  return item;
}

// A queued change that genuinely can't be applied (a real validation
// rejection, not just "still offline") is recorded here rather than
// retried forever or silently dropped — surfaced by OfflineSyncBanner so
// it's never invisible, same "never fail silently" discipline the rest of
// this codebase already follows for its own bare-catch bugs (see the
// routines-saving post-ship fix in the README).
interface SyncError {
  kind: QueuedMutationKind;
  message: string;
  at: string;
}

function recordSyncError(kind: QueuedMutationKind, message: string) {
  if (typeof window === 'undefined') return;
  const errors: SyncError[] = JSON.parse(window.localStorage.getItem(SYNC_ERRORS_KEY) ?? '[]');
  errors.push({ kind, message, at: new Date().toISOString() });
  window.localStorage.setItem(SYNC_ERRORS_KEY, JSON.stringify(errors));
  window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

export function getSyncErrors(): SyncError[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(SYNC_ERRORS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function clearSyncErrors() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SYNC_ERRORS_KEY);
  window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

// --- Optimistic local cache patches -------------------------------------
// Each one is a deliberately narrow, hand-written patch for exactly the one
// query its action affects — not a generic cache-patching framework. The
// temporary `offline-<uuid>` id is never sent anywhere; it only exists so
// React has a stable key until the queue flushes and a real refetch
// replaces it with the server's actual record.

export function applyOptimisticCreateTask(input: {
  title: string;
  estimatedDurationMinutes?: number;
  goalId?: string;
}) {
  try {
    const data = apolloClient.cache.readQuery<any>({ query: TODAY_PLAN_QUERY });
    if (!data?.todayPlan) return;
    const optimisticTask = {
      __typename: 'Task',
      id: `offline-${newId()}`,
      title: input.title,
      status: 'PENDING',
      priority: 3,
      dueDate: null,
      estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
      goal: null,
    };
    apolloClient.cache.writeQuery({
      query: TODAY_PLAN_QUERY,
      data: {
        todayPlan: {
          ...data.todayPlan,
          tasks: [...data.todayPlan.tasks, optimisticTask],
          tasksCount: data.todayPlan.tasksCount + 1,
          hasTasks: true,
        },
      },
    });
  } catch {
    // Best-effort — if nothing's cached yet to patch (e.g. the very first
    // load happened offline), there's nothing to optimistically show; the
    // real data appears once the queue flushes and refetches for real.
  }
}

export function applyOptimisticCompleteTask(taskId: string) {
  try {
    const data = apolloClient.cache.readQuery<any>({ query: TODAY_PLAN_QUERY });
    if (!data?.todayPlan) return;
    const remaining = data.todayPlan.tasks.filter((t: any) => t.id !== taskId);
    apolloClient.cache.writeQuery({
      query: TODAY_PLAN_QUERY,
      data: {
        todayPlan: {
          ...data.todayPlan,
          tasks: remaining,
          tasksCount: remaining.length,
          hasTasks: remaining.length > 0,
        },
      },
    });
  } catch {
    // Best-effort — see applyOptimisticCreateTask.
  }
}

export function applyOptimisticJournalEntry(content: string) {
  try {
    const data = apolloClient.cache.readQuery<any>({ query: JOURNAL_ENTRIES_QUERY });
    if (!data?.journalEntries) return;
    const now = new Date().toISOString();
    const optimisticEntry = {
      __typename: 'JournalEntry',
      id: `offline-${newId()}`,
      content,
      // Journal sentiment analysis increment — scoring is a real network
      // call to Anthropic, which is exactly what's unavailable while
      // offline; `null` here matches what a fresh entry already looks like
      // before AnthropicClient.analyzeSentiment runs, so this optimistic
      // row renders with no sentiment label until the real sync replaces it
      // (see JournalPage's own sentimentLabel — null/undefined shows
      // nothing, not a placeholder).
      sentimentScore: null,
      createdAt: now,
      updatedAt: now,
    };
    apolloClient.cache.writeQuery({
      query: JOURNAL_ENTRIES_QUERY,
      data: {
        journalEntries: {
          ...data.journalEntries,
          edges: [
            { __typename: 'JournalEntryEdge', cursor: optimisticEntry.id, node: optimisticEntry },
            ...data.journalEntries.edges,
          ],
        },
      },
    });
  } catch {
    // Best-effort — see applyOptimisticCreateTask.
  }
}

// --- Flushing ------------------------------------------------------------

let flushing = false;

// Replays the queue in order against the real server, once a connection is
// back. Stops (rather than skipping ahead) the moment it hits a genuine
// network failure, leaving everything from that point on in the queue for
// the next reconnect — preserves ordering instead of applying later items
// before earlier ones. A non-network rejection (the mutation reached the
// server and was genuinely refused) is treated differently: that one
// specific item is removed and recorded as a sync error rather than
// retried forever, since retrying an already-refused change would never
// succeed on its own.
export async function flushQueue(): Promise<void> {
  if (flushing || !isOnline()) return;
  flushing = true;
  try {
    const queue = readQueue();
    let touchedTasks = false;
    let touchedJournal = false;

    for (const item of queue) {
      try {
        if (item.kind === 'createTask') {
          await apolloClient.mutate({ mutation: CREATE_TASK, variables: item.variables });
          touchedTasks = true;
        } else if (item.kind === 'completeTask') {
          await apolloClient.mutate({ mutation: COMPLETE_TASK, variables: item.variables });
          touchedTasks = true;
        } else if (item.kind === 'createJournalEntry') {
          await apolloClient.mutate({ mutation: CREATE_JOURNAL_ENTRY, variables: item.variables });
          touchedJournal = true;
        }
        removeFromQueue(item.id);
      } catch (error) {
        if ((error as any)?.networkError) {
          break;
        }
        recordSyncError(item.kind, (error as Error).message ?? 'Unknown error');
        removeFromQueue(item.id);
      }
    }

    // One refetch per affected query at the end, not per queued item —
    // reconciles every optimistic patch above with real server data (real
    // ids, real timestamps) in a single pass.
    if (touchedTasks) await apolloClient.refetchQueries({ include: [TODAY_PLAN_QUERY] });
    if (touchedJournal) await apolloClient.refetchQueries({ include: [JOURNAL_ENTRIES_QUERY] });
  } finally {
    flushing = false;
  }
}
