'use client';

import { useEffect } from 'react';

// PWA + offline support increment. Same "invisible, mounted once, no UI of
// its own" shape as TimezoneSync — this component's only job is calling
// `navigator.serviceWorker.register` once on mount. Guarded by a feature
// check (older/unusual browsers, and any non-browser render environment,
// simply skip this silently rather than throwing) and wrapped in a
// best-effort `catch` — a failed registration should never break the app
// itself, same "an enhancement must never break the page" principle
// AiPlanCard's own optional features already follow.
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Best-effort — offline support degrades gracefully to "just a
      // normal web app that needs a connection," not a broken one.
    });
  }, []);

  return null;
}
