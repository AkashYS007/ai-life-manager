import * as Sentry from '@sentry/browser';

// Deployment-maturity pass (2026-08-27): optional browser-side error
// monitoring, same graceful-degradation pattern as every optional backend
// integration in this codebase (see apps/backend/src/config/env.validation.ts's
// own SENTRY_DSN comment) — a no-op when NEXT_PUBLIC_SENTRY_DSN isn't set.
//
// Deliberately `@sentry/browser`, not the full `@sentry/nextjs` SDK: the
// latter needs a `withSentryConfig` webpack-plugin wrapper around
// next.config.js to auto-inject server/edge instrumentation and upload
// source maps, which is real added build-time surface this pass couldn't
// verify end-to-end in this sandbox (this repo's own `next build` can't run
// here at all right now — an unrelated, already-documented sandbox network
// block on fonts.googleapis.com). Plain client-side capture (uncaught JS
// errors and unhandled promise rejections in the browser, installed
// automatically by Sentry.init's default integrations) is real, working
// coverage with none of that risk — and for a client-heavy app like this
// one (GraphQL/Apollo run entirely client-side), it's the majority of what
// "frontend monitoring" means in practice. Full server/edge capture via
// @sentry/nextjs is a reasonable follow-up once this baseline is confirmed
// working against a real Sentry project.
let initialized = false;

export function initErrorMonitoring(): void {
  if (initialized) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
  });
  initialized = true;
}
