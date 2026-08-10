'use client';

import { useEffect, useState } from 'react';
import { clearSyncErrors, getQueue, getSyncErrors, OFFLINE_QUEUE_CHANGED_EVENT } from '../lib/offlineQueue';

// PWA + offline support increment: the one small piece of UI this whole
// feature actually shows a person, beyond items just quietly appearing.
// Two states, not mutually exclusive: "N changes waiting to sync" (a
// calm, informational strip — nothing's wrong, just not confirmed by the
// server yet) and "some changes couldn't be saved" (a real problem,
// dismissible, listing what happened) — the second is what
// lib/offlineQueue.ts's flushQueue records when a queued item comes back
// genuinely rejected rather than just "still offline."
export function OfflineSyncBanner() {
  const [pendingCount, setPendingCount] = useState(0);
  const [errors, setErrors] = useState<{ kind: string; message: string }[]>([]);

  useEffect(() => {
    function refresh() {
      setPendingCount(getQueue().length);
      setErrors(getSyncErrors());
    }
    refresh();
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refresh);
  }, []);

  if (pendingCount === 0 && errors.length === 0) return null;

  return (
    <div className="mx-4 mb-3 flex flex-col gap-2">
      {pendingCount > 0 && (
        <div
          role="status"
          className="rounded-control border border-border dark:border-border-dark bg-surface dark:bg-surface-dark px-3 py-2 text-xs text-text-secondary dark:text-text-secondary-dark"
        >
          {pendingCount} change{pendingCount === 1 ? '' : 's'} waiting to sync — will save automatically once you're back online.
        </div>
      )}
      {errors.length > 0 && (
        <div className="rounded-control border border-danger/40 bg-surface dark:bg-surface-dark px-3 py-2">
          <p className="text-xs text-danger dark:text-danger-dark" role="alert">
            {errors.length} offline change{errors.length === 1 ? '' : 's'} couldn't be saved: {errors.map((e) => e.message).join('; ')}
          </p>
          <button onClick={clearSyncErrors} className="mt-1 text-xs font-medium text-accent">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
