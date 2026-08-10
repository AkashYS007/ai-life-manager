'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@apollo/client';
import {
  GOOGLE_CALENDAR_ACCOUNT,
  START_GOOGLE_CALENDAR_CONNECTION,
  DISCONNECT_GOOGLE_CALENDAR,
  SYNC_GOOGLE_CALENDAR_NOW,
  CALENDAR_EVENTS_IN_RANGE,
  TODAY_PLAN_QUERY,
} from '../lib/queries';

// Connect/status/sync/disconnect for Google Calendar (pull-only sync
// increment). The "Connect" button does a full browser navigation (not an
// Apollo call) to Google's own consent screen — that's Google's redirect,
// not our GraphQL API, so this deliberately isn't a client-side fetch.
//
// Fix onboarding calendar-connect redirect increment: `returnTo` is
// optional and only ever set to `'onboarding'` by the one caller that
// needs it (onboarding/page.tsx's calendar step) — passed straight through
// as a mutation variable, so the backend's signed OAuth `state` carries it
// and the callback controller can redirect back to `/onboarding` instead
// of always `/calendar`. Left unset (undefined) here defaults to the exact
// behavior this component always had before this increment.
export function GoogleCalendarConnect({
  refetchQueries,
  returnTo,
}: {
  refetchQueries: any[];
  returnTo?: string;
}) {
  const searchParams = useSearchParams();
  const connectResult = searchParams.get('googleConnect'); // 'success' | 'error' | null, set by the backend's OAuth callback redirect
  const [connectError, setConnectError] = useState<string | null>(null);

  const { data, loading } = useQuery(GOOGLE_CALENDAR_ACCOUNT);
  const [startConnection, { loading: starting }] = useMutation(START_GOOGLE_CALENDAR_CONNECTION);
  const [disconnect, { loading: disconnecting }] = useMutation(DISCONNECT_GOOGLE_CALENDAR, {
    refetchQueries: [{ query: GOOGLE_CALENDAR_ACCOUNT }, ...refetchQueries],
  });
  const [syncNow, { loading: syncing }] = useMutation(SYNC_GOOGLE_CALENDAR_NOW, {
    refetchQueries: [
      { query: GOOGLE_CALENDAR_ACCOUNT },
      { query: CALENDAR_EVENTS_IN_RANGE, variables: (refetchQueries[0] as any)?.variables },
      { query: TODAY_PLAN_QUERY },
    ],
  });

  async function handleConnect() {
    setConnectError(null);
    const result = await startConnection({ variables: { returnTo } });
    const payload = result.data?.startGoogleCalendarConnection;
    if (payload?.authUrl) {
      window.location.href = payload.authUrl;
      return;
    }
    setConnectError(payload?.errors?.[0]?.message ?? "Couldn't start the connection. Try again.");
  }

  if (loading) return null;

  const account = data?.googleCalendarAccount;

  return (
    <div className="mx-4 mb-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
      {connectResult === 'error' && (
        <p className="mb-2 text-xs text-danger dark:text-danger-dark" role="alert">
          Couldn&apos;t connect Google Calendar. Check the server has valid Google credentials configured, then try
          again.
        </p>
      )}
      {connectResult === 'success' && !account && (
        <p className="mb-2 text-xs text-text-secondary dark:text-text-secondary-dark">Connecting…</p>
      )}
      {connectError && <p className="mb-2 text-xs text-danger dark:text-danger-dark" role="alert">{connectError}</p>}

      {account ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
              Google Calendar connected
            </h2>
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              {account.externalAccountEmail ?? 'Unknown account'}
              {account.lastSyncedAt &&
                ` · last synced ${new Date(account.lastSyncedAt).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}`}
              {/* Real-time calendar updates (webhooks) increment — only
                  ever shown when a real, not-yet-expired Google channel is
                  on file (see IntegrationsResolver's own toGraphCalendarAccount);
                  absent (not "off"/false-styled) whenever it isn't, the same
                  "honest empty state, nothing shown rather than a
                  placeholder" pattern every other optional signal in this
                  app already follows. */}
              {account.realtimeSyncEnabled && (
                <>
                  {' · '}
                  <span className="text-accent dark:text-accent-dark">real-time sync active</span>
                </>
              )}
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
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Bring your Google Calendar events in here too.
          </p>
          <button
            disabled={starting}
            onClick={handleConnect}
            className="shrink-0 rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {starting ? 'Connecting…' : 'Connect Google Calendar'}
          </button>
        </div>
      )}
    </div>
  );
}
