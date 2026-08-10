'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import {
  APPLE_CALENDAR_ACCOUNT,
  CONNECT_APPLE_CALENDAR,
  DISCONNECT_APPLE_CALENDAR,
  SYNC_APPLE_CALENDAR_NOW,
  CALENDAR_EVENTS_IN_RANGE,
  TODAY_PLAN_QUERY,
} from '../lib/queries';

// Connect/status/sync/disconnect for Apple (CalDAV) Calendar. Genuinely
// different UX from Google/Microsoft's single "Connect" button: CalDAV has
// no OAuth consent screen, so this is a real form (Apple ID + app-specific
// password) submitted directly to our own GraphQL mutation rather than a
// browser redirect to Apple's own site — see the README for how to
// generate an app-specific password at appleid.apple.com.
export function AppleCalendarConnect({ refetchQueries }: { refetchQueries: any[] }) {
  const [appleId, setAppleId] = useState('');
  const [appSpecificPassword, setAppSpecificPassword] = useState('');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data, loading } = useQuery(APPLE_CALENDAR_ACCOUNT);
  const [connect, { loading: connecting }] = useMutation(CONNECT_APPLE_CALENDAR, {
    refetchQueries: [{ query: APPLE_CALENDAR_ACCOUNT }, ...refetchQueries],
  });
  const [disconnect, { loading: disconnecting }] = useMutation(DISCONNECT_APPLE_CALENDAR, {
    refetchQueries: [{ query: APPLE_CALENDAR_ACCOUNT }, ...refetchQueries],
  });
  const [syncNow, { loading: syncing }] = useMutation(SYNC_APPLE_CALENDAR_NOW, {
    refetchQueries: [
      { query: APPLE_CALENDAR_ACCOUNT },
      { query: CALENDAR_EVENTS_IN_RANGE, variables: (refetchQueries[0] as any)?.variables },
      { query: TODAY_PLAN_QUERY },
    ],
  });

  async function handleConnect() {
    setConnectError(null);
    const result = await connect({ variables: { input: { appleId, appSpecificPassword } } });
    const payload = result.data?.connectAppleCalendar;
    if (payload?.account) {
      setAppleId('');
      setAppSpecificPassword('');
      setShowForm(false);
      return;
    }
    setConnectError(payload?.errors?.[0]?.message ?? "Couldn't connect. Check your Apple ID and password.");
  }

  if (loading) return null;

  const account = data?.appleCalendarAccount;

  return (
    <div className="mx-4 mb-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
      {account ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
              Apple Calendar connected
            </h2>
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              {account.externalAccountEmail ?? 'Unknown account'}
              {account.lastSyncedAt &&
                ` · last synced ${new Date(account.lastSyncedAt).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}`}
            </p>
          </div>
          <div className="flex shrink-0 gap-3">
            <button
              disabled={syncing}
              onClick={() => syncNow()}
              className="text-xs font-medium text-accent dark:text-accent-dark disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              disabled={disconnecting}
              onClick={() => disconnect()}
              className="text-xs text-text-secondary hover:text-danger dark:hover:text-danger-dark dark:text-text-secondary-dark disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : showForm ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Use an app-specific password, not your real Apple ID password — see the README for how to generate one.
          </p>
          <input
            value={appleId}
            onChange={(e) => setAppleId(e.target.value)}
            placeholder="Apple ID (e.g. you@icloud.com)"
            aria-label="Apple ID email"
            className="rounded-control border border-border dark:border-border-dark bg-transparent px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark"
          />
          <input
            value={appSpecificPassword}
            onChange={(e) => setAppSpecificPassword(e.target.value)}
            placeholder="App-specific password"
            aria-label="App-specific password"
            type="password"
            className="rounded-control border border-border dark:border-border-dark bg-transparent px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark"
          />
          {connectError && <p className="text-xs text-danger dark:text-danger-dark" role="alert">{connectError}</p>}
          <div className="flex gap-2">
            <button
              disabled={connecting || !appleId || !appSpecificPassword}
              onClick={handleConnect}
              className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-control border border-border dark:border-border-dark px-3 py-1.5 text-xs text-text-secondary dark:text-text-secondary-dark"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Bring your Apple Calendar events in here too.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="shrink-0 rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white"
          >
            Connect Apple Calendar
          </button>
        </div>
      )}
    </div>
  );
}
