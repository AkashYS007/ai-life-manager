import * as Sentry from '@sentry/node';

// Deployment-maturity pass (2026-08-27): optional error-monitoring
// integration, flagged 🟠 "Monitoring/error alerts — needed" in the
// deployment-maturity scorecard. Confirmed via grep beforehand that this
// backend had zero error-tracking of any kind — NestJS's `Logger` writes to
// stdout/Railway's log viewer, but nothing aggregates, alerts, or pages on a
// real spike in errors.
//
// Deliberately a thin wrapper rather than wiring `@sentry/node` directly at
// every call site: every caller below checks `initialized` instead of
// re-checking `SENTRY_DSN` itself, so this stays a true no-op — not just an
// unused SDK — when no DSN is configured (the same graceful-degradation
// pattern every other optional integration in this codebase already
// follows; see `env.validation.ts`'s own comment on `SENTRY_DSN`).
let initialized = false;

export function initSentry(dsn: string | undefined): void {
  if (!dsn) {
    return;
  }
  Sentry.init({
    dsn,
    // Conservative default: capture errors, not a sampled slice of every
    // request's performance trace. Tracing can be turned on later by
    // raising this once there's an actual account to look at the data in —
    // no code change needed, just this one number.
    tracesSampleRate: 0,
  });
  initialized = true;
}

export function reportError(error: unknown): void {
  if (!initialized) {
    return;
  }
  Sentry.captureException(error);
}
