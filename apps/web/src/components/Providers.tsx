'use client';

import { ApolloProvider } from '@apollo/client';
import { ClerkProvider, useAuth, useClerk } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
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
import { NativePushRegistration } from './NativePushRegistration';
import { initErrorMonitoring } from '../lib/error-monitoring';

// A no-op when NEXT_PUBLIC_SENTRY_DSN isn't set (see error-monitoring.ts).
// Called at module scope, same as this file's other client-only singletons
// (apolloClient), so it runs once per page load rather than once per render.
if (typeof window !== 'undefined') {
  initErrorMonitoring();
}

const isDevAuth = process.env.NEXT_PUBLIC_AUTH_MODE === 'dev';

// Static marketing pages that carry zero Apollo/session dependency and, per
// Google's OAuth branding-verification crawler, must return real content in
// the *initial* server HTML rather than nothing (see the cacheReady gate
// below). Kept as an explicit allowlist, not a heuristic, so this can never
// accidentally include an authenticated app route.
const PUBLIC_PATHS = ['/', '/privacy', '/terms'];

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

  // Bug found 2026-08-18 while debugging Google's OAuth branding
  // verification: useEffect never runs during SSR, so cacheReady is
  // *always* false on the server, so `if (!cacheReady) return null` used to
  // mean every single route rendered null in the server-generated HTML —
  // not just the authenticated app, but the public landing page, /privacy,
  // /terms too. Real content only ever appeared after client JS mounted and
  // this effect resolved, which a plain HTTP crawler (Google's branding
  // checker included) never waits for. That's the actual reason branding
  // verification kept failing "home page doesn't explain its purpose" and
  // "app name doesn't match" even after LandingPage.tsx's content was
  // independently confirmed correct and deployed — the content was real,
  // it just never reached the response Google's crawler reads.
  //
  // Static marketing pages don't touch Apollo or the persisted cache at
  // all, so they have no reason to wait on cacheReady in the first place —
  // skip the gate for exactly those paths, unchanged for every other
  // route. Authenticated app pages keep the original cold-cache protection
  // exactly as before.
  const pathname = usePathname();
  const isPublicPage = PUBLIC_PATHS.includes(pathname ?? '');

  if (!isPublicPage && !cacheReady) return null;

  const app = (
    <ApolloProvider client={apolloClient}>
      {!isDevAuth && <ClerkTokenBridge />}
      {!isDevAuth && <ClerkSignOutBridge />}
      {!isDevAuth && <ClerkUserProfileBridge />}
      <TimezoneSync />
      <OnboardingGate />
      <SyncManager />
      {/* Native app shell increment (2026-08-20): registers this device for
          real OS-level push (FCM) when running inside the Capacitor app —
          a true no-op on regular web, see the component's own comment. */}
      <NativePushRegistration />
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
