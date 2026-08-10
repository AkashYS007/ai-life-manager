'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@apollo/client';
import {
  MICROSOFT_CALENDAR_ACCOUNT,
  START_MICROSOFT_CALENDAR_CONNECTION,
  DISCONNECT_MICROSOFT_CALENDAR,
  SYNC_MICROSOFT_CALENDAR_NOW,
  CALENDAR_EVENTS_IN_RANGE,
  TODAY_PLAN_QUERY,
} from '../lib/queries';

// Mirrors GoogleCalendarConnect.tsx exactly, just pointed at the Microsoft
// operations — same "Connect" button does a full browser navigation to
// Microsoft's own consent screen, same reasoning (that's Microsoft's
// redirect, not our GraphQL API). Same optional `returnTo` prop too — see
// GoogleCalendarConnect.tsx's own comment for what it's for.
export function MicrosoftCalendarConnect({
  refetchQueries,
  returnTo,
}: {
  refetchQueries: any[];
  returnTo?: string;
}) {
  const searchParams = useSearchParams();
  const connectResult = searchParams.get('microsoftConnect'); // 'success' | 'error' | null, set by the backend's OAuth callback redirect
  const [connectError, setConnectError] = useState<string | null>(null);

  const { data, loading } = useQuery(MICROSOFT_CALENDAR_ACCOUNT);
  const [startConnection, { loading: starting }] = useMutation(START_MICROSOFT_CALENDAR_CONNECTION);
  const [disconnect, { loading: disconnecting }] = useMutation(DISCONNECT_MICROSOFT_CALENDAR, {
    refetchQueries: [{ query: MICROSOFT_CALENDAR_ACCOUNT }, ...refetchQueries],
  });
  const [syncNow, { loading: syncing }] = useMutation(SYNC_MICROSOFT_CALENDAR_NOW, {
    refetchQueries: [
      { query: MICROSOFT_CALENDAR_ACCOUNT },
      { query: CALENDAR_EVENTS_IN_RANGE, variables: (refetchQueries[0] as any)?.variables },
      { query: TODAY_PLAN_QUERY },
    ],
  });

  async function handleConnect() {
    setConnectError(null);
    const result = await startConnection({ variables: { returnTo } });
    const payload = result.data?.startMicrosoftCalendarConnection;
    if (payload?.authUrl) {
      window.location.href = payload.authUrl;
      return;
    }
    setConnectError(payload?.errors?.[0]?.message ?? "Couldn't start the connection. Try again.");
  }

  if (loading) return null;

  const account = data?.microsoftCalendarAccount;

  return (
    <div className="mx-4 mb-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
      {connectResult === 'error' && (
        <p className="mb-2 text-xs text-danger dark:text-danger-dark" role="alert">
          Couldn&apos;t connect Microsoft Calendar. Check the server has valid Microsoft credentials configured,
          then try again.
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
              Microsoft Calendar connected
            </h2>
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              {account.externalAccountEmail ?? 'Unknown account'}
              {account.lastSyncedAt &&
                ` · last synced ${new Date(account.lastSyncedAt).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}`}
              {/* Real-time calendar updates (webhooks) increment — same
                  honest-empty-state reasoning GoogleCalendarConnect's own
                  identical badge documents. */}
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
            Bring your Outlook/365 Calendar events in here too.
          </p>
          <button
            disabled={starting}
            onClick={handleConnect}
            className="shrink-0 rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {starting ? 'Connecting…' : 'Connect Microsoft Calendar'}
          </button>
        </div>
      )}
    </div>
  );
}
