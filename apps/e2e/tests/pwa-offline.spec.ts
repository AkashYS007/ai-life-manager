import { test, expect } from '@playwright/test';
import { unique } from './helpers';

// This is exactly the category of behavior every prior increment's README
// section flagged as "cannot be verified in this sandbox, verify yourself
// in a real browser" — service worker registration, offline app-shell
// loading, and the offline mutation queue. Running here, in a real
// Chromium instance, is the whole point of this suite.
test.describe('PWA installability + service worker', () => {
  test('the manifest is linked and the service worker registers', async ({ page }) => {
    await page.goto('/today');

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBe('/manifest.webmanifest');

    // PwaRegister.tsx registers /sw.js on mount — poll briefly since
    // registration is async and there's no other UI signal that it's done.
    await expect
      .poll(async () => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state))
      .toBe('activated');
  });
});

test.describe('Offline app shell', () => {
  test('a page visited online still loads with no network at all', async ({ page, context }) => {
    // First, online: this is what actually populates the service worker's
    // runtime cache (see public/sw.js's stale-while-revalidate handler) —
    // an offline-first visit to a route that was never cached couldn't
    // possibly load, same as any uncached page.
    await page.goto('/today');
    await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible();

    await context.setOffline(true);
    await page.reload();

    // The app shell itself should still render — same manual check the
    // PWA increment's README asks a person to do in DevTools' Network tab.
    await expect(page.getByPlaceholder('Add a task…')).toBeVisible({ timeout: 15_000 });

    await context.setOffline(false);
  });
});

test.describe('Offline mutation queue', () => {
  test('adding a task while offline queues it, shows the sync banner, and syncs for real once back online', async ({
    page,
    context,
  }) => {
    const title = unique('E2E offline task');

    // Load Today online first so Apollo's persisted cache has something to
    // patch optimistically against (see lib/offlineQueue.ts's own comment
    // on why this matters) — the same precondition the PWA README's manual
    // steps call out explicitly.
    await page.goto('/today');
    await expect(page.getByPlaceholder('Add a task…')).toBeVisible();

    await context.setOffline(true);

    await page.getByPlaceholder('Add a task…').fill(title);
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // Appears immediately via the optimistic cache patch, and the sync
    // banner reflects one change waiting.
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText(/waiting to sync/)).toBeVisible();

    await context.setOffline(false);

    // SyncManager flushes the queue on the browser's `online` event — the
    // banner should clear on its own with no manual refresh.
    await expect(page.getByText(/waiting to sync/)).not.toBeVisible({ timeout: 15_000 });

    // Reload to prove the task really reached the server, not just the
    // local optimistic cache patch.
    await page.reload();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });
});
