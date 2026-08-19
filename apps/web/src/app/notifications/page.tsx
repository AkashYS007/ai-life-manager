'use client';

import { useState } from 'react';
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
    refetchQueries: [{ query: NOTIFICATIONS_QUERY }, { query: UNREAD_NOTIFICATION_COUNT_QUERY }],
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
  const { data, loading } = useQuery(NOTIFICATION_PREFERENCES_QUERY);
  const [quietHoursStart, setQuietHoursStart] = useState('');
  const [quietHoursEnd, setQuietHoursEnd] = useState('');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!initialized && data?.me) {
    setQuietHoursStart(data.me.quietHoursStart ?? '');
    setQuietHoursEnd(data.me.quietHoursEnd ?? '');
    setPushEnabled(data.me.pushNotificationsEnabled);
    setEmailEnabled(data.me.emailNotificationsEnabled);
    setSmsEnabled(data.me.smsNotificationsEnabled);
    setPhoneNumber(data.me.phoneNumber ?? '');
    setInitialized(true);
  }

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
          },
        },
      });
      const errors = result.data?.updateNotificationPreferences?.errors ?? [];
      if (errors.length > 0) {
        setError(errors[0].message ?? "Couldn't save those preferences. Try again.");
        return;
      }
      setSaved(true);
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

  return (
    <div className="mx-4 mb-4 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
      <h2 className="mb-3 text-sm font-medium text-text-primary dark:text-text-primary-dark">Preferences</h2>

      <div className="mb-3 flex items-center gap-3">
        <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
          Quiet hours from
          <input
            type="time"
            value={quietHoursStart}
            onChange={(e) => setQuietHoursStart(e.target.value)}
            className="ml-2 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
          />
        </label>
        <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
          to
          <input
            type="time"
            value={quietHoursEnd}
            onChange={(e) => setQuietHoursEnd(e.target.value)}
            className="ml-2 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
          />
        </label>
      </div>
      <p className="mb-3 text-xs text-text-secondary dark:text-text-secondary-dark">
        Notifications that would arrive during quiet hours wait until they end. Leave both blank for no quiet hours.
      </p>

      <div className="mb-3 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          <input type="checkbox" checked={pushEnabled} onChange={(e) => setPushEnabled(e.target.checked)} />
          In-app notifications
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)} />
          Email
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          <input type="checkbox" checked={smsEnabled} onChange={(e) => setSmsEnabled(e.target.checked)} />
          SMS
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
          onChange={(e) => setPhoneNumber(e.target.value)}
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
  const { data, loading, error, refetch } = useQuery(NOTIFICATIONS_QUERY, { variables: { first: 30 } });
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
