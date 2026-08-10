import { test, expect } from '@playwright/test';

// Exercises the one piece of the Real notification delivery increment that
// a real browser can actually complete end to end without a live push
// service intercepting anything: granting permission and successfully
// subscribing via the real Chromium PushManager, which requires reaching
// the browser's own internal push service over the network — precisely
// the kind of outbound request the build sandbox's network allowlist
// blocks (see this suite's own README section), so this spec, more than
// any other in this file, needs a real, unrestricted network to pass.
test.describe('Push notification subscribe flow', () => {
  test.beforeEach(async ({ context }) => {
    // Chromium-only API — matches this suite's single 'chromium' project
    // (see playwright.config.ts).
    await context.grantPermissions(['notifications']);
  });

  test('turning on browser notifications registers a real subscription, and turning it off unregisters it', async ({
    page,
  }) => {
    await page.goto('/notifications');

    const toggle = page.getByRole('button', { name: /Turn on browser notifications/ });
    // If the backend has no VAPID keys configured, PushSubscribeButton
    // renders nothing at all rather than an error (see its own comment) —
    // fail loudly here rather than silently passing on a misconfigured
    // environment, since VAPID_PUBLIC_KEY/PRIVATE_KEY are meant to already
    // be filled in apps/backend/.env for local dev.
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();

    await expect(page.getByRole('button', { name: /Turn off browser notifications/ })).toBeVisible({
      timeout: 15_000,
    });

    // A real subscription should now exist in the browser itself.
    const hasSubscription = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription !== null;
    });
    expect(hasSubscription).toBe(true);

    await page.getByRole('button', { name: /Turn off browser notifications/ }).click();
    await expect(page.getByRole('button', { name: /Turn on browser notifications/ })).toBeVisible({
      timeout: 15_000,
    });
  });
});
