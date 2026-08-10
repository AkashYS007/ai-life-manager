'use client';

import { useEffect } from 'react';
import { useQuery } from '@apollo/client';
import { usePathname, useRouter } from 'next/navigation';
import { ME_ONBOARDING_QUERY } from '../lib/queries';

// Paths that must stay reachable even for a not-yet-onboarded account —
// the onboarding flow itself, and the two Clerk-hosted auth screens (a
// person mid-sign-up has no session yet, so `me` won't even resolve there,
// but this list is checked first regardless).
const EXEMPT_PATH_PREFIXES = ['/onboarding', '/sign-in', '/sign-up'];

// Diagnostic onboarding increment. Mirrors TimezoneSync's shape exactly
// (mounted once in Providers, alongside every page, renders nothing) —
// same "invisible background component, not a settings screen" precedent —
// except this one's job is a redirect rather than a silent write. A brand
// new account's onboardingCompletedAt is null (see users.service.ts's
// getOrCreateFromAuth) until the diagnostic quiz's completeOnboarding
// mutation runs, so this is what actually sends a first-time visitor to
// /onboarding instead of leaving them to stumble onto Today with zero
// baseline set.
export function OnboardingGate() {
  const { data } = useQuery(ME_ONBOARDING_QUERY, { errorPolicy: 'ignore' });
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!data?.me) return; // no session yet (signed out, or Clerk still loading) — nothing to gate
    if (data.me.onboardingCompletedAt) return;
    if (EXEMPT_PATH_PREFIXES.some((p) => pathname?.startsWith(p))) return;

    router.replace('/onboarding');
  }, [data, pathname, router]);

  return null;
}
