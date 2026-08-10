'use client';

import { ApolloProvider } from '@apollo/client';
import { ClerkProvider, useAuth, useClerk } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import {
  apolloClient,
  initCachePersistence,
  registerClerkTokenGetter,
  registerClerkSignOut,
  registerClerkOpenUserProfile,
} from '../lib/apollo-client';
import { TimezoneSync } from './TimezoneSync';
import { OnboardingGate } from './OnboardingGate';
import { SyncManager } from './SyncManager';

const isDevAuth = process.env.NEXT_PUBLIC_AUTH_MODE === 'dev';

// Bridges Clerk's useAuth().getToken() into the plain Apollo Client module
// (see lib/apollo-client.ts) — only mounted when a real Clerk session is in
// play, since AUTH_MODE=dev never needs a Clerk token.
function ClerkTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    registerClerkTokenGetter(() => getToken());
  }, [getToken]);
  return null;
}

// Account deletion increment: same bridge pattern as ClerkTokenBridge above,
// registering Clerk's real signOut() so the Settings page can end the
// session after a real deleteAccount mutation without calling a Clerk hook
// itself (Settings renders under AUTH_MODE=dev too, which never mounts
// <ClerkProvider>, so calling useClerk() directly there would throw).
function ClerkSignOutBridge() {
  const { signOut } = useClerk();
  useEffect(() => {
    registerClerkSignOut(() => signOut());
  }, [signOut]);
  return null;
}

// Editable email increment: same bridge pattern once more, registering
// Clerk's real openUserProfile() — its own hosted account-management
// modal — so the Settings page's "Change email" button can call a plain
// function without needing to invoke a Clerk hook itself.
function ClerkUserProfileBridge() {
  const { openUserProfile } = useClerk();
  useEffect(() => {
    registerClerkOpenUserProfile(() => openUserProfile());
  }, [openUserProfile]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // PWA + offline support increment: the persisted cache has to actually
  // finish loading from localStorage *before* any query runs, or every
  // query fires with a cold, empty cache and shows a loading/error state
  // even when the exact data it wants is sitting in storage two lines
  // away — this is most visible on an offline page reload, which is
  // exactly the scenario this increment exists for. A brief blank render
  // is a fine trade for that; every page under this already shows its own
  // loading state a moment later anyway once real queries kick off.
  const [cacheReady, setCacheReady] = useState(false);
  useEffect(() => {
    initCachePersistence().finally(() => setCacheReady(true));
  }, []);

  if (!cacheReady) return null;

  const app = (
    <ApolloProvider client={apolloClient}>
      {!isDevAuth && <ClerkTokenBridge />}
      {!isDevAuth && <ClerkSignOutBridge />}
      {!isDevAuth && <ClerkUserProfileBridge />}
      <TimezoneSync />
      <OnboardingGate />
      <SyncManager />
      {/* Accessibility (WCAG AA) pass: a keyboard user's very first Tab
          press on any page would otherwise land on whatever the first
          focusable element inside that page's own header happens to be
          (a nav link, a form field) with no way to jump straight past it —
          this is the standard "skip to content" pattern, present on every
          page since it's mounted once here rather than per-page. Visually
          hidden until it actually receives focus (sr-only, then
          not-sr-only on :focus), so sighted mouse users never see it.
          Targets `#main-content`, which every page's own top-level `<main>`
          now carries. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>
      {children}
    </ApolloProvider>
  );

  // AUTH_MODE=dev deliberately skips ClerkProvider entirely so the app runs
  // with zero external credentials in local/sandbox environments (see
  // apps/backend/src/auth/auth.guard.ts for the matching backend behavior).
  if (isDevAuth) {
    return app;
  }

  return (
    <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
      {app}
    </ClerkProvider>
  );
}
