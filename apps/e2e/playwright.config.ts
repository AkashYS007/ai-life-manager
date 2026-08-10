import { defineConfig, devices } from '@playwright/test';

// Real browser-automation test suite increment — the gap every prior
// increment's README section flagged as "cannot be verified in this
// sandbox, verify yourself in a real browser" (PWA install, offline mode,
// push notifications). Deliberately does NOT use Playwright's `webServer`
// option to auto-start the backend/frontend: the backend needs a real
// Postgres instance (`docker compose up -d` + `prisma migrate`) already
// running, which no amount of `webServer` config can stand up on its own —
// so this assumes both dev servers are already running exactly the way
// every other "verify yourself" section in the root README already
// instructs (`npm run dev` in apps/backend, `npm run dev` in apps/web, in
// two separate terminals), and simply points at `http://localhost:3000`.
//
// Single worker, no parallelism: every spec authenticates as the one fixed
// dev-auth account (`NEXT_PUBLIC_DEV_USER_EMAIL`, see apollo-client.ts) —
// there's no per-test account isolation the way the backend's own e2e
// suite gets via a fresh devEmail per test, since the frontend's dev-auth
// header is baked in from a build-time env var, not something a browser
// session can override per-test. Specs are written to tolerate this
// (unique, timestamped titles; assertions scoped to what a spec itself just
// created) rather than assuming a clean/empty account — but running two
// specs concurrently against the same live account would still be a real
// source of flakiness this config avoids outright.
export default defineConfig({
  testDir: './tests',
  globalSetup: require.resolve('./global-setup'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
