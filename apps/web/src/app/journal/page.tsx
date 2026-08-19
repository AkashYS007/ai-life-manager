'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  JOURNAL_ENTRIES_QUERY,
  CREATE_JOURNAL_ENTRY,
  UPDATE_JOURNAL_ENTRY,
  DELETE_JOURNAL_ENTRY,
} from '../../lib/queries';
import { BottomNav } from '../../components/BottomNav';
import { OfflineSyncBanner } from '../../components/OfflineSyncBanner';
import { QueryErrorNotice } from '../../components/QueryErrorNotice';
import { applyOptimisticJournalEntry, enqueue, isOnline } from '../../lib/offlineQueue';

// "Guided prompts" per PRD §7.3 — a few static conversation-starters you
// can tap to drop into the composer, not a whole prompt-management system.
// Clicking one inserts it as a starting line rather than submitting
// anything, so it's just a nudge, never a forced structure.
const GUIDED_PROMPTS = [
  'What went well today?',
  "What's on my mind right now?",
  'What am I grateful for today?',
  'What would make tomorrow better?',
];

// Journal sentiment analysis increment. Purely a display concern — the
// backend already decides what counts as a clear trend for its own AI
// Memory fact (see MemoryService.refreshJournalSentimentPattern's own
// ±0.3 threshold); this reuses the same ±0.3 boundary just for labeling one
// entry's own score, so a person sees the same "clearly positive / clearly
// negative / anything in between reads as even" boundary the AI itself is
// using, not two silently different thresholds. Only ever shown when
// sentimentScore is a real number — undefined/null (AI not configured, a
// scoring call failed, or an entry written before this increment shipped)
// renders nothing rather than a placeholder, an honest empty state like
// every other "nothing to show yet" case in this app.
function sentimentLabel(score: number | null | undefined): { text: string; className: string } | null {
  if (score === null || score === undefined) return null;
  if (score >= 0.3) return { text: 'Felt good', className: 'text-accent dark:text-accent-dark' };
  if (score <= -0.3) return { text: 'Felt heavy', className: 'text-danger dark:text-danger-dark' };
  return { text: 'Mixed', className: 'text-text-secondary dark:text-text-secondary-dark' };
}

function relativeLabel(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const time = then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((startOfNow.getTime() - startOfThen.getTime()) / (24 * 60 * 60 * 1000));
  if (dayDiff <= 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Yesterday at ${time}`;
  if (dayDiff < 7) return `${dayDiff} days ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function JournalComposer() {
  const [content, setContent] = useState('');
  const [createEntry, { loading }] = useMutation(CREATE_JOURNAL_ENTRY, {
    refetchQueries: [{ query: JOURNAL_ENTRIES_QUERY }],
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;
    const variables = { input: { content: trimmed } };

    // PWA + offline support increment: "journaling" is the third of the
    // PRD's three named offline-capable actions. Same check-first-then-
    // fallback shape as QuickAddTask/TaskRow's own offline paths.
    if (!isOnline()) {
      applyOptimisticJournalEntry(trimmed);
      enqueue('createJournalEntry', variables);
    } else {
      try {
        await createEntry({ variables });
      } catch {
        applyOptimisticJournalEntry(trimmed);
        enqueue('createJournalEntry', variables);
      }
    }
    setContent('');
  }

  return (
    <form onSubmit={handleSubmit} className="mx-4 mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {GUIDED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => setContent((c) => (c ? c : prompt + '\n'))}
            className="rounded-control border border-border dark:border-border-dark px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary dark:text-text-secondary-dark"
          >
            {prompt}
          </button>
        ))}
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write whatever's on your mind…"
        aria-label="Journal entry"
        rows={4}
        disabled={loading}
        className="w-full resize-none rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <button
        type="submit"
        disabled={loading || !content.trim()}
        className="self-end rounded-control bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Save entry
      </button>
    </form>
  );
}

function JournalEntryRow({
  id,
  content,
  sentimentScore,
  createdAt,
}: {
  id: string;
  content: string;
  sentimentScore?: number | null;
  createdAt: string;
}) {
  const [editing, setEditing] = useState(false);
  const sentiment = sentimentLabel(sentimentScore);
  const [draft, setDraft] = useState(content);
  const [updateEntry, { loading: saving }] = useMutation(UPDATE_JOURNAL_ENTRY, {
    refetchQueries: [{ query: JOURNAL_ENTRIES_QUERY }],
  });
  const [deleteEntry, { loading: deleting }] = useMutation(DELETE_JOURNAL_ENTRY, {
    variables: { id },
    refetchQueries: [{ query: JOURNAL_ENTRIES_QUERY }],
  });

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await updateEntry({ variables: { id, input: { content: trimmed } } });
    setEditing(false);
  }

  return (
    <div data-testid={`journal-entry-${id}`} className="rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5">
      <p className="mb-1 text-xs text-text-secondary dark:text-text-secondary-dark">
        {relativeLabel(createdAt)}
        {sentiment && (
          <>
            {' · '}
            <span className={sentiment.className}>{sentiment.text}</span>
          </>
        )}
      </p>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Edit journal entry"
            rows={4}
            className="w-full resize-none rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="flex gap-2">
            <button
              disabled={saving || !draft.trim()}
              onClick={handleSave}
              className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => {
                setDraft(content);
                setEditing(false);
              }}
              className="rounded-control border border-border dark:border-border-dark px-3 py-1.5 text-xs text-text-secondary dark:text-text-secondary-dark"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm text-text-primary dark:text-text-primary-dark">{content}</p>
          <div className="mt-1.5 flex gap-3">
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-text-secondary hover:text-text-primary dark:text-text-secondary-dark"
            >
              Edit
            </button>
            <button
              disabled={deleting}
              onClick={() => deleteEntry()}
              className="text-xs text-text-secondary hover:text-danger dark:hover:text-danger-dark dark:text-text-secondary-dark disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function JournalPage() {
  const { data, loading, error, fetchMore, refetch } = useQuery(JOURNAL_ENTRIES_QUERY);

  const edges = data?.journalEntries?.edges ?? [];
  const pageInfo = data?.journalEntries?.pageInfo;

  function loadMore() {
    if (!pageInfo?.hasNextPage) return;
    fetchMore({
      variables: { after: pageInfo.endCursor },
      updateQuery: (prev, { fetchMoreResult }) => {
        if (!fetchMoreResult) return prev;
        return {
          journalEntries: {
            ...fetchMoreResult.journalEntries,
            edges: [...prev.journalEntries.edges, ...fetchMoreResult.journalEntries.edges],
          },
        };
      },
    });
  }

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Journal</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Free-form or guided — whatever helps you think.
        </p>
      </div>

      <OfflineSyncBanner />
      <JournalComposer />

      {loading && (
        <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>
      )}

      {error && <QueryErrorNotice error={error} what="your journal" onRetry={() => refetch()} />}

      {!loading && !error && (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {edges.length ? (
            edges.map((edge: { node: { id: string; content: string; sentimentScore?: number | null; createdAt: string } }) => (
              <JournalEntryRow
                key={edge.node.id}
                id={edge.node.id}
                content={edge.node.content}
                sentimentScore={edge.node.sentimentScore}
                createdAt={edge.node.createdAt}
              />
            ))
          ) : (
            <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-5">
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                Nothing written yet — your first entry will show up here.
              </p>
            </div>
          )}

          {pageInfo?.hasNextPage && (
            <button
              onClick={loadMore}
              className="mt-1 rounded-control border border-border dark:border-border-dark px-4 py-2 text-sm font-medium text-text-primary dark:text-text-primary-dark"
            >
              Load more
            </button>
          )}
        </div>
      )}

      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
