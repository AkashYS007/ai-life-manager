'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { ME_TIMEZONE_QUERY, UPDATE_PROFILE_TIMEZONE } from '../lib/queries';

// Every "today"/"now" calculation on the backend (Habits, Signals, the AI
// planner, Chat) reads user.timezone, which defaults to "UTC" for a
// brand-new account (see users.service.ts's getOrCreateFromAuth) — nothing
// on the frontend ever overrode that until this component. It detects the
// browser's real IANA timezone once per session and silently writes it back
// via updateProfile if it doesn't match what's stored, so every downstream
// feature starts computing "today" against the person's actual local day
// instead of UTC.
//
// Visible settings screen increment: this silent write now backs off
// entirely once `timezoneManual` is set — a person who's explicitly saved a
// timezone from /settings made a deliberate choice, and this component
// overwriting it right back to the browser's own value the next time any
// page loads would silently undo it. `/settings` is also the one place
// that can turn `timezoneManual` back off, handing control back to this
// component.
export function TimezoneSync() {
  const { data } = useQuery(ME_TIMEZONE_QUERY, { errorPolicy: 'ignore' });
  const [updateProfile] = useMutation(UPDATE_PROFILE_TIMEZONE);
  const hasSynced = useRef(false);

  useEffect(() => {
    if (!data?.me || hasSynced.current || data.me.timezoneManual) return;

    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected || detected === data.me.timezone) return;

    hasSynced.current = true;
    updateProfile({ variables: { timezone: detected } }).catch(() => {
      // Best-effort — if this fails (offline, backend hiccup), the app just
      // keeps using whatever timezone was already stored, and we'll try
      // again next time this component mounts. Nothing else depends on this
      // succeeding synchronously.
      hasSynced.current = false;
    });
  }, [data, updateProfile]);

  return null;
}
