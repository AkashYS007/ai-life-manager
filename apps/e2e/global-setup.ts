import { request } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Real browser-automation test suite increment. Every spec authenticates
// as the app's one fixed dev-auth account (see playwright.config.ts's own
// comment on why there's no per-test account isolation here) — but that
// account might never have completed the diagnostic onboarding quiz yet,
// in which case OnboardingGate would redirect every single spec straight
// to /onboarding before it ever saw the page it actually came to test.
// Rather than teaching every spec to detect and click through that quiz,
// this runs once, before any spec, and completes onboarding directly over
// the GraphQL API (every field is optional — see
// CompleteOnboardingInput's own comment) if it isn't done already. Reading
// `apps/web/.env.local` directly (rather than requiring yet another
// separate env var) keeps this in sync with whatever dev account the web
// app itself is actually configured to send.
function readDevUserEmail(): string {
  if (process.env.E2E_DEV_USER_EMAIL) return process.env.E2E_DEV_USER_EMAIL;
  try {
    const envPath = path.resolve(__dirname, '../web/.env.local');
    const contents = fs.readFileSync(envPath, 'utf-8');
    const match = contents.match(/^NEXT_PUBLIC_DEV_USER_EMAIL\s*=\s*"?([^"\n]+?)"?\s*$/m);
    if (match) return match[1].trim();
  } catch {
    // apps/web/.env.local doesn't exist or couldn't be read — fall through
    // to the same default apollo-client.ts itself falls back to.
  }
  return 'akash@example.com';
}

export const DEV_USER_EMAIL = readDevUserEmail();
export const BACKEND_GRAPHQL_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:4000/graphql';

export default async function globalSetup(): Promise<void> {
  const ctx = await request.newContext({
    extraHTTPHeaders: { 'x-dev-user-email': DEV_USER_EMAIL, 'content-type': 'application/json' },
  });

  try {
    const check = await ctx.post(BACKEND_GRAPHQL_URL, {
      data: { query: '{ me { id onboardingCompletedAt } }' },
    });
    const body = await check.json();

    if (!body?.data?.me?.onboardingCompletedAt) {
      await ctx.post(BACKEND_GRAPHQL_URL, {
        data: { query: 'mutation { completeOnboarding(input: {}) { user { id } errors { code } } }' },
      });
    }
  } finally {
    await ctx.dispose();
  }
}
