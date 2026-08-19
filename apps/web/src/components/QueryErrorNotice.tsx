'use client';

import type { ApolloError } from '@apollo/client';
import Link from 'next/link';

// Bug fix (2026-08-19): every page that runs a top-level useQuery had its
// own copy-pasted "Couldn't load your X. Check that the backend is
// running [on <url>]." message for ANY query error, with no distinction
// between causes. That's fine advice for a developer reading server logs,
// but it's the literal text a real end user saw -- including, confirmed
// directly, a friend of the app owner's who opened the site from WhatsApp's
// in-app browser and got exactly this "check that the backend is running"
// message shown as a real UI error, even though the backend was (and is)
// completely healthy the whole time. The real cause: their GraphQL request
// went out with no auth token attached (Clerk's client-side session hadn't
// hydrated yet in that browser context, or the session had genuinely
// lapsed), which the backend correctly rejects with a "Missing bearer
// token" / FORBIDDEN error -- a completely different, much more common
// situation than the backend actually being down, and one with an easy
// fix (sign in again) rather than a scary infra-sounding message a normal
// person can't act on.
//
// This component replaces every one of those 12 duplicated blocks (today,
// journal, goals, tasks, more, notifications, routines, calendar, habits,
// analytics, memory, reflection) with one that tells the two situations
// apart and gives a real, actionable next step for each -- and never
// exposes an internal backend URL to an end user, which the old /today
// copy did.
function isAuthError(error?: ApolloError): boolean {
  if (!error) return false;
  return (
    error.graphQLErrors?.some((e) => {
      const code = (e.extensions?.code as string | undefined)?.toUpperCase();
      return code === 'FORBIDDEN' || code === 'UNAUTHENTICATED' || /bearer token/i.test(e.message);
    }) ?? false
  );
}

export function QueryErrorNotice({
  error,
  what,
  onRetry,
}: {
  error?: ApolloError;
  /** Fills "Couldn't load {what} right now." -- e.g. "your day", "your journal". */
  what: string;
  /** A real refetch() from the same useQuery, when the caller has one handy. Falls back to a full reload otherwise. */
  onRetry?: () => void;
}) {
  if (isAuthError(error)) {
    return (
      <p className="mx-4 mb-3 text-sm text-danger dark:text-danger-dark" role="alert">
        Your session needs a refresh.{' '}
        <Link href="/sign-in" className="font-medium underline">
          Sign in again
        </Link>
        , or{' '}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="font-medium underline"
        >
          reload the page
        </button>
        .
      </p>
    );
  }

  return (
    <p className="mx-4 mb-3 text-sm text-danger dark:text-danger-dark" role="alert">
      Couldn&apos;t load {what} right now. Please check your connection and{' '}
      <button
        type="button"
        onClick={onRetry ?? (() => window.location.reload())}
        className="font-medium underline"
      >
        try again
      </button>
      .
    </p>
  );
}
