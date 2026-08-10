'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { UPDATE_MEMORY_FACT, DELETE_MEMORY_FACT, MEMORY_FACTS_QUERY } from '../lib/queries';

export function MemoryFactRow({ id, content }: { id: string; content: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  const refetchQueries = [{ query: MEMORY_FACTS_QUERY }];
  const [updateFact, { loading: updating }] = useMutation(UPDATE_MEMORY_FACT, { refetchQueries });
  const [deleteFact, { loading: deleting }] = useMutation(DELETE_MEMORY_FACT, {
    variables: { id },
    refetchQueries,
  });

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === content) {
      setEditing(false);
      setDraft(content);
      return;
    }
    await updateFact({ variables: { id, content: trimmed } });
    setEditing(false);
  }

  if (editing) {
    return (
      <div
        data-testid={`memory-fact-row-${id}`}
        className="flex items-center gap-2 rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5"
      >
        <input
          autoFocus
          aria-label="Edit memory fact"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') {
              setDraft(content);
              setEditing(false);
            }
          }}
          disabled={updating}
          className="flex-1 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          disabled={updating}
          onClick={handleSave}
          className="text-xs font-medium text-accent dark:text-accent-dark disabled:opacity-50"
        >
          Save
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid={`memory-fact-row-${id}`}
      className="flex items-center gap-3 rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5"
    >
      <span className="flex-1 text-sm text-text-primary dark:text-text-primary-dark">{content}</span>
      <button
        onClick={() => setEditing(true)}
        className="text-xs text-text-secondary hover:text-accent dark:text-text-secondary-dark"
      >
        Edit
      </button>
      <button
        disabled={deleting}
        onClick={() => deleteFact()}
        className="text-xs text-text-secondary hover:text-danger dark:hover:text-danger-dark dark:text-text-secondary-dark disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}
