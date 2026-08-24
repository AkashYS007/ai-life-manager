// Lightweight retry-with-backoff (backend review follow-up, 2026-08-24 —
// AI/planner audit finding "Delivery retries"). Deliberately NOT a durable
// job queue: adding one (e.g. BullMQ + Redis) is a real infrastructure and
// hosting-cost decision — a new stateful service this app doesn't currently
// run — that belongs to the user to make explicitly, not something to
// introduce silently as a side effect of a "tighten this up" pass. This is
// the smallest fix that actually closes the gap the audit found: every
// delivery channel (WebPushService, NativePushService, EmailService,
// SmsService) already wraps its one real external call in a try/catch that
// logs and swallows on ANY failure, including a transient one (a 500 from
// Resend/Twilio, a momentary network blip to the push service) — and
// NotificationsService.attemptDelivery then unconditionally marks the row
// `deliveredAt` in its own `finally` block regardless of whether delivery
// actually succeeded. A transient failure today isn't retried at all: it's
// recorded as permanently delivered and never attempted again. This helper
// gives each channel a small, bounded number of in-process retries with
// exponential backoff before it falls through to that same existing
// catch-and-log path — genuinely transient failures now get a couple of
// real extra chances within the same request, everything else (a
// permanently-invalid recipient, an unconfigured/expired credential) fails
// exactly as fast as it already did.
export interface RetryOptions {
  // Total attempts including the first (non-retry) one.
  attempts: number;
  // Delay before the first retry; doubles after each subsequent failure
  // (attempt 2 waits baseDelayMs, attempt 3 waits baseDelayMs*2, ...).
  baseDelayMs: number;
  // Return false to fail fast without burning the remaining attempts — for
  // errors a retry can never fix (e.g. "this push subscription is gone for
  // good", a 4xx client error). Defaults to always-retry when omitted.
  shouldRetry?: (error: unknown) => boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts, baseDelayMs, shouldRetry } = options;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === attempts;
      const retryable = shouldRetry ? shouldRetry(error) : true;
      if (isLastAttempt || !retryable) {
        throw error;
      }
      await delay(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  // Unreachable (the loop above always either returns or throws), but keeps
  // TypeScript's control-flow analysis happy without an `as never`/`!`.
  throw lastError;
}

// Shape shared by both HTTP-based channels (EmailService/Resend,
// SmsService/Twilio) so `shouldRetry` can key off the real response status
// rather than parsing it back out of a message string.
export class DeliveryHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DeliveryHttpError';
  }
}

// A 4xx from either provider means the request itself was wrong (bad
// recipient, bad auth, bad payload) — retrying it will just fail the same
// way three times instead of once. A 5xx, or no response at all (a thrown
// network error, which arrives as some other Error and is retried by the
// default always-retry behavior), is exactly the transient case worth a
// couple of extra attempts for.
export function isRetryableHttpError(error: unknown): boolean {
  if (error instanceof DeliveryHttpError) {
    return error.status >= 500;
  }
  return true;
}
