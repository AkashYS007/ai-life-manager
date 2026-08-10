'use client';

import { useEffect } from 'react';
import { flushQueue } from '../lib/offlineQueue';

// PWA + offline support increment: invisible, mounted once, app-wide —
// same shape as TimezoneSync/PwaRegister. Flushes the offline queue (see
// lib/offlineQueue.ts) both on mount (there may already be a queue left
// over from a previous session that closed while still offline) and every
// time the browser's `online` event fires.
export function SyncManager() {
  useEffect(() => {
    flushQueue();
    function handleOnline() {
      flushQueue();
    }
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  return null;
}
