'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import {
  MARK_NOTIFICATION_READ,
  NOTIFICATIONS_QUERY,
  NOTIFICATION_PREFERENCES_QUERY,
  UNREAD_NOTIFICATION_COUNT_QUERY,
  UPDATE_NOTIFICATION_PREFERENCES,
} from '../../lib/queries';
import { BottomNav } from '../../components/BottomNav';
import { PushSubscribeButton } from '../../components/PushSubscribeButton';
import { QueryErrorNotice } from '../../components/QueryErrorNotice';

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  deeplink: string;
  read: boolean;
  createdAt: string;
}

function relativeLabel(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Smart notifications increment, extended by the Real notification delivery
// increment: this page (plus the small unread-count link on Today) remains
// the always-available fallback, but a notification is now also attempted
// as a real browser push (if this device has turned that on below) and/or
// email (if enabled below) — see NotificationsService.attemptDelivery.
function NotificationRowView({ notification }: { notification: NotificationRow }) {
  const [markRead] = useMutation(MARK_NOTIFICATION_READ, {
    variables: { id: notification.id },
    // Stale-list fix: a refetchQueries entry with no `variables` refetches
    // that query with an *empty* variables set — a completely different
    // cache slot (`notifications({})`) from the one this page actually
    // reads (`notifications({"first":30})`, from the useQuery below). That
    // mismatch meant marking a notification read never actually refreshed
    // what was on screen; it silently populated a cache entry nothing
    // renders from. Matching the variables here is what makes this
    // genuinely update the visible list.
    refetchQueries: [
      { query: NOTIFICATIONS_QUERY, variables: { first: 30 } },
      { query: UNREAD_NOTIFICATION_COUNT_QUERY },
    ],
  });

  return (
    <Link
      href={notification.deeplink || '/today'}
      onClick={() => {
        if (!notification.read) markRead();
      }}
      className={`block rounded-card px-3 py-2.5 ${
        notification.read
          ? 'bg-surface dark:bg-surface-dark'
          : 'border border-accent/40 bg-surface dark:bg-surface-dark'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">{notification.title}</p>
        {!notification.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />}
      </div>
      <p className="mt-0.5 text-sm text-text-secondary dark:text-text-secondary-dark">{notification.body}</p>
      <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">{relativeLabel(notification.createdAt)}</p>
    </Link>
  );
}

// SMS delivery increment: a plain, loose client-side shape check before
// ever calling the mutation — not a full E.164 parser (that real validation
// lives server-side in UpdateNotificationPreferencesInput, see its own
// comment on why), just enough to catch an obviously-wrong value (missing
// the leading `+`, letters, too short) before it reaches a real Twilio API
// call and comes back as a less helpful server-thrown error.
const PHONE_LOOKS_VALID = /^\+[1-9]\d{1,14}$/;

function PreferencesForm() {
  // Fix (frontend consistency pass, 2026-08-25): same gap as SETTINGS_QUERY
  // on settings/page.tsx (see that file's own comment for the full
  // reasoning) — `error` was never destructured or checked here either. A
  // genuine query failure fell straight through to the same render branch
  // as a real successful load, showing every toggle at its blank `useState`
  // default with no indication anything had failed; hitting Save from there
  // would submit those defaults as real preferences, silently overwriting
  // whatever quiet-hours/channel settings actually existed.
  const { data, loading, error: queryError, refetch: refetchPreferences } = useQuery(NOTIFICATION_PREFERENCES_QUERY);
  const [quietHoursStart, setQuietHoursStart] = useState('');
  const [quietHoursEnd, setQuietHoursEnd] = useState('');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  // Notification controls increment (2026-08-25) — defaults to `true`,
  // matching the field's own DB default (see schema.prisma), since voice
  // notifications were unconditionally on for everyone before this control
  // existed at all.
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [initialized, setInitialized] = useState(false);
  // Fix (frontend audit, 2026-08-25): matches the same fix on
  // settings/page.tsx (see its own comment for the full reasoning) — this
  // form used to sync from `data.me` exactly once, on whichever `data.me`
  // it saw first. `dirty` lets the effect below keep re-syncing from
  // `data.me` for as long as the person hasn't started editing (every
  // setter below is paired with `setDirty(true)`), so a later external
  // change — a refetch after save, a slower-arriving network response —
  // still reaches the form, without ever overwriting in-progress edits.
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dirty || !data?.me) return;
    setQuietHoursStart(data.me.quietHoursStart ?? '');
    setQuietHoursEnd(data.me.quietHoursEnd ?? '');
    setPushEnabled(data.me.pushNotificationsEnabled);
    setEmailEnabled(data.me.emailNotificationsEnabled);
    setSmsEnabled(data.me.smsNotificationsEnabled);
    setPhoneNumber(data.me.phoneNumber ?? '');
    setVoiceEnabled(data.me.voiceNotificationsEnabled);
    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.me, dirty]);

  const [updatePreferences, { loading: saving }] = useMutation(UPDATE_NOTIFICATION_PREFERENCES, {
    refetchQueries: [{ query: NOTIFICATION_PREFERENCES_QUERY }],
  });

  async function handleSave() {
    setSaved(false);
    setError(null);
    const trimmedPhone = phoneNumber.trim();
    if (trimmedPhone && !PHONE_LOOKS_VALID.test(trimmedPhone)) {
      setError('Phone number must be in E.164 format, e.g. +15551234567.');
      return;
    }
    try {
      const result = await updatePreferences({
        variables: {
          input: {
            quietHoursStart: quietHoursStart || null,
            quietHoursEnd: quietHoursEnd || null,
            pushNotificationsEnabled: pushEnabled,
            emailNotificationsEnabled: emailEnabled,
            smsNotificationsEnabled: smsEnabled,
            phoneNumber: trimmedPhone || null,
            voiceNotificationsEnabled: voiceEnabled,
          },
        },
      });
      const errors = result.data?.updateNotificationPreferences?.errors ?? [];
      if (errors.length > 0) {
        setError(errors[0].message ?? "Couldn't save those preferences. Try again.");
        return;
      }
      setSaved(true);
      // The refetch this mutation triggers reflects exactly what was just
      // saved — safe to let the sync effect above apply it once it lands.
      setDirty(false);
    } catch {
      // A malformed phone number that slipped past the loose client-side
      // check above still gets caught server-side (UpdateNotificationPreferencesInput's
      // own @Matches) — that surfaces as a thrown GraphQL error, not a
      // payload error, so it needs its own catch here rather than the
      // `errors` array check above.
      setError("Couldn't save those preferences — check the phone number format and try again.");
    }
  }

  if (loading && !initialized) {
    return <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>;
  }

  // Only ever shown before this form has real data to fall back on — once
  // `initialized` is true, a later refetch failure keeps showing the
  // last-known-good form instead of replacing it with an error, same
  // precedent as settings/page.tsx's own matching fix.
  if (queryError && !initialized) {
    return <QueryErrorNotice error={queryError} what="your notification preferences" onRetry={() => refetchPreferences()} />;
  }

  return (
    <div className="mx-4 mb-4 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
      <h2 className="mb-3 text-sm font-medium text-text-primary dark:text-text-primary-dark">Preferences</h2>

      <div className="mb-3 flex items-center gap-3">
        <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
          Quiet hours from
          <input
            type="time"
            value={quietHoursStart}
            onChange={(e) => { setDirty(true); setQuietHoursStart(e.target.value); }}
            className="ml-2 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
          />
        </label>
        <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
          to
          <input
            type="time"
            value={quietHoursEnd}
            onChange={(e) => { setDirty(true); setQuietHoursEnd(e.target.value); }}
            className="ml-2 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
          />
        </label>
      </div>
      <p className="mb-3 text-xs text-text-secondary dark:text-text-secondary-dark">
        Notifications that would arrive during quiet hours wait until they end. Leave both blank for no quiet hours.
      </p>

      <div className="mb-3 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          <input type="checkbox" checked={pushEnabled} onChange={(e) => { setDirty(true); setPushEnabled(e.target.checked); }} />
          In-app notifications
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          <input type="checkbox" checked={emailEnabled} onChange={(e) => { setDirty(true); setEmailEnabled(e.target.checked); }} />
          Email
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          <input type="checkbox" checked={smsEnabled} onChange={(e) => { setDirty(true); setSmsEnabled(e.target.checked); }} />
          SMS
        </label>
        {/* Notification controls increment (2026-08-25): voice notifications
            (VoiceNotifications.tsx on web/PWA, and the native Android
            equivalent — see apps/mobile/README.md) used to be
            unconditionally on with no way to turn them off. Kept in this
            same checkbox group rather than a separate section — it's a
            delivery-style preference, same as the three above, not a
            distinct settings category. */}
        <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          <input type="checkbox" checked={voiceEnabled} onChange={(e) => { setDirty(true); setVoiceEnabled(e.target.checked); }} />
          Read notifications aloud (voice)
        </label>
      </div>

      {/* SMS delivery increment: smsNotificationsEnabled has existed since
          the Smart notifications increment, but there was never a phone
          number anywhere to actually send to — shown regardless of whether
          the checkbox above is on, same "the field exists whether or not
          you've opted in yet" treatment quiet hours already gets. */}
      <div className="mb-3">
        <label className="mb-1 block text-xs text-text-secondary dark:text-text-secondary-dark">
          Phone number for SMS
        </label>
        <input
          type="tel"
          value={phoneNumber}
          onChange={(e) => { setDirty(true); setPhoneNumber(e.target.value); }}
          placeholder="+15551234567"
          aria-label="Phone number for SMS notifications"
          // Screen-reader pass: the only client-side validation this form
          // has is the phone-format check, and the server-side catch-all
          // error also explicitly names the phone number — so tying the
          // error to this field, even for the generic-save-failure case,
          // stays accurate rather than misleading.
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'notifications-phone-error' : undefined}
          className="w-full rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          E.164 format, including the country code (e.g. +1 for the US). Leave blank if you don&apos;t want SMS.
        </p>
      </div>

      <PushSubscribeButton />

      {error && (
        <p id="notifications-phone-error" className="mb-2 text-xs text-danger dark:text-danger-dark" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
        {/* Screen-reader pass: was a plain, non-live span — a screen reader
            only hears "Saved." if it happens to already be reading near the
            button when this appears. role="status" makes it a real,
            polite live region instead. */}
        {saved && !saving && (
          <span role="status" className="text-xs text-text-secondary dark:text-text-secondary-dark">
            Saved.
          </span>
        )}
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  // Stale-cache fix: this app persists the Apollo cache to localStorage
  // (see lib/apollo-client.ts) so the shell still has data offline — but
  // combined with the default `cache-first` fetchPolicy, that meant this
  // exact query+variables pair, once fetched, was served straight from the
  // (now permanently stale) persisted cache on every later visit, with no
  // new network request ever firing — no matter how many real
  // notifications piled up server-side in the meantime. `cache-and-network`
  // keeps the instant-from-cache render (so this still feels fast and
  // works offline) while always kicking off a real background refetch too,
  // so a stale persisted list gets corrected the moment the network is
  // actually available.
  const { data, loading, error, refetch } = useQuery(NOTIFICATIONS_QUERY, {
    variables: { first: 30 },
    fetchPolicy: 'cache-and-network',
  });
  const notifications: NotificationRow[] = data?.notifications ?? [];

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Notifications</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Plan and recommendation updates, quiet-hours-aware.
        </p>
      </div>

      <PreferencesForm />

      {loading && <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>}

      {error && <QueryErrorNotice error={error} what="your notifications" onRetry={() => refetch()} />}

      {!loading && !error && (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {notifications.length ? (
            notifications.map((n) => <NotificationRowView key={n.id} notification={n} />)
          ) : (
            <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-5">
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                Nothing yet — generating an AI plan or recommendations will show up here.
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
