import { z } from 'zod';

// Every environment variable the backend depends on is validated once at boot.
// A misconfigured deployment should fail fast and loud, not throw a confusing
// error the first time an unrelated request happens to touch the missing value.
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_MODE: z.enum(['dev', 'clerk']).default('clerk'),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  // Google Calendar sync (pull-only increment) — all optional so the app
  // still boots for anyone who hasn't set up Google Cloud credentials yet;
  // the connect mutation reports GOOGLE_NOT_CONFIGURED instead of the whole
  // server refusing to start over an unrelated, opt-in feature.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  OAUTH_STATE_SECRET: z.string().optional(),
  // Microsoft (Outlook/365) calendar sync — same graceful-degradation
  // pattern as Google above, and deliberately reuses TOKEN_ENCRYPTION_KEY /
  // OAUTH_STATE_SECRET rather than provider-specific secrets, since both
  // are generic (token-at-rest encryption, OAuth redirect signing) and
  // apply the same way regardless of which provider's tokens they're
  // protecting.
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_REDIRECT_URI: z.string().optional(),
  // Real-time calendar updates (webhooks) increment — the publicly
  // reachable base URL of this backend (e.g. https://api.example.com, no
  // trailing slash), used to build the callback URL handed to Google's
  // channels.watch / Microsoft Graph's subscriptions API so they know where
  // to POST a change notification. Deliberately its own var, not derived
  // from GOOGLE_REDIRECT_URI/MICROSOFT_REDIRECT_URI — those are browser
  // OAuth redirect targets (could differ from this server's own address
  // behind a proxy/gateway) and this is a server-to-server callback target;
  // conflating them would be a coincidence, not a guarantee. Optional, same
  // graceful-degradation pattern as every other integration above — without
  // it, webhook registration is silently skipped and this app falls back to
  // exactly what it already does today: manual "Sync now" only. Loopback/
  // private addresses (localhost, an internal-only hostname) technically
  // pass this validation but can never actually receive a real webhook from
  // Google/Microsoft's servers — that's a deployment/networking concern
  // this app can't detect from inside itself, not something worth failing
  // boot over.
  BACKEND_PUBLIC_URL: z.string().optional(),
  // AI daily plan generation — optional, same graceful-degradation pattern
  // as the Google Calendar vars above; requestReplan reports AI_NOT_CONFIGURED
  // instead of the server refusing to boot.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
  // Real Stripe billing integration — same graceful-degradation pattern as
  // Google/Microsoft above, not the looser raw-process.env tier Twilio/
  // Resend/VAPID use: real money is enough at stake here to argue for the
  // stricter "all four or none, validated at boot" treatment. Without these,
  // createCheckoutSession/createBillingPortalSession report
  // STRIPE_NOT_CONFIGURED and Settings falls back to the old simulated
  // instant plan-switch — the server still boots fine either way.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID_PLUS: z.string().optional(),
  STRIPE_PRICE_ID_PRO: z.string().optional(),
}).refine(
  (env) => env.AUTH_MODE !== 'clerk' || !!env.CLERK_SECRET_KEY,
  { message: 'CLERK_SECRET_KEY is required when AUTH_MODE=clerk', path: ['CLERK_SECRET_KEY'] },
).refine(
  (env) => env.NODE_ENV !== 'production' || env.AUTH_MODE === 'clerk',
  { message: 'AUTH_MODE=dev is not allowed when NODE_ENV=production', path: ['AUTH_MODE'] },
).refine(
  (env) => !env.GOOGLE_CLIENT_ID || !!(env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI && env.TOKEN_ENCRYPTION_KEY && env.OAUTH_STATE_SECRET),
  {
    message:
      'GOOGLE_CLIENT_ID is set but one of GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI / TOKEN_ENCRYPTION_KEY / OAUTH_STATE_SECRET is missing — Google sync needs all five or none.',
    path: ['GOOGLE_CLIENT_ID'],
  },
).refine(
  (env) => !env.MICROSOFT_CLIENT_ID || !!(env.MICROSOFT_CLIENT_SECRET && env.MICROSOFT_REDIRECT_URI && env.TOKEN_ENCRYPTION_KEY && env.OAUTH_STATE_SECRET),
  {
    message:
      'MICROSOFT_CLIENT_ID is set but one of MICROSOFT_CLIENT_SECRET / MICROSOFT_REDIRECT_URI / TOKEN_ENCRYPTION_KEY / OAUTH_STATE_SECRET is missing — Microsoft sync needs all four (plus the shared TOKEN_ENCRYPTION_KEY/OAUTH_STATE_SECRET) or none.',
    path: ['MICROSOFT_CLIENT_ID'],
  },
).refine(
  (env) => !env.STRIPE_SECRET_KEY || !!(env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_ID_PLUS && env.STRIPE_PRICE_ID_PRO),
  {
    message:
      'STRIPE_SECRET_KEY is set but one of STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_ID_PLUS / STRIPE_PRICE_ID_PRO is missing — Stripe billing needs all four or none.',
    path: ['STRIPE_SECRET_KEY'],
  },
);

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration — see printed field errors above.');
  }
  return parsed.data;
}
