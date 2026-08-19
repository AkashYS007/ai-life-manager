'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { MEMORY_FACTS_QUERY, CREATE_MEMORY_FACT } from '../../lib/queries';
import { MemoryFactRow } from '../../components/MemoryFactRow';
import { BottomNav } from '../../components/BottomNav';
import { QueryErrorNotice } from '../../components/QueryErrorNotice';

// "Manual memory first" scope (the approved AI Memory increment): the
// person directly tells the AI things to remember. No automatic learning,
// no embeddings — just a plain list that the AI daily planner and chat
// both read as real context on every request.
export default function MemoryPage() {
  const [content, setContent] = useState('');
  const { data, loading, error, refetch } = useQuery(MEMORY_FACTS_QUERY);
  const [createFact, { loading: creating }] = useMutation(CREATE_MEMORY_FACT, {
    refetchQueries: [{ query: MEMORY_FACTS_QUERY }],
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;
    await createFact({ variables: { content: trimmed } });
    setContent('');
  }

  const facts = data?.memoryFacts ?? [];

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Memory</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Tell the AI things to remember about you. The daily planner and chat both use these every time.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mx-4 mb-3 flex gap-2">
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder='e.g. "Never schedule calls before 10am"'
          aria-label="New memory fact"
          disabled={creating}
          className="flex-1 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={creating || !content.trim()}
          className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {loading && (
        <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>
      )}

      {error && <QueryErrorNotice error={error} what="your memory" onRetry={() => refetch()} />}

      {!loading && !error && (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {facts.length ? (
            facts.map((fact: { id: string; content: string }) => (
              <MemoryFactRow key={fact.id} id={fact.id} content={fact.content} />
            ))
          ) : (
            <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-5">
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                Nothing yet — add something above and the AI will factor it into daily plans and chat replies.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
