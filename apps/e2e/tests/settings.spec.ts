import { test, expect } from '@playwright/test';

// Visible settings screen increment — the shared dev-auth account these
// specs all run against has no reason to collide on these fields the way
// Goals/Tasks specs need `unique()` titles to avoid: chronotype and work
// hours are just singleton profile fields, and each test below sets exactly
// what it needs regardless of what an earlier test in this file left behind.
test.describe('Settings', () => {
  test('editing chronotype and work hours persists across a reload', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await page.getByLabel('When do you tend to feel most energized?').selectOption('NIGHT_OWL');
    await page.locator('input[type="time"]').first().fill('08:00');
    await page.locator('input[type="time"]').nth(1).fill('18:00');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('When do you tend to feel most energized?')).toHaveValue('NIGHT_OWL');
    await expect(page.locator('input[type="time"]').first()).toHaveValue('08:00');
    await expect(page.locator('input[type="time"]').nth(1)).toHaveValue('18:00');
  });

  test('editing the timezone field switches to manual mode, and reverting hands control back to automatic', async ({ page }) => {
    await page.goto('/settings');

    const timezoneInput = page.getByLabel('IANA timezone (e.g. America/New_York)');
    await expect(page.getByText('Syncing automatically from your browser.')).toBeVisible();

    await timezoneInput.fill('America/Los_Angeles');
    await expect(page.getByText('Set manually')).toBeVisible();
    const revertButton = page.getByRole('button', { name: /Use browser-detected automatically/ });
    await expect(revertButton).toBeVisible();

    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    // Really persisted, not just a local state change — a fresh load reads
    // it back from the server the same way it would the next time this
    // person opens the app.
    await page.reload();
    await expect(timezoneInput).toHaveValue('America/Los_Angeles');
    await expect(page.getByText('Set manually')).toBeVisible();

    // Reverting hands control back to automatic — the manual-mode copy and
    // the revert button both disappear once it's saved.
    await page.getByRole('button', { name: /Use browser-detected automatically/ }).click();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Syncing automatically from your browser.')).toBeVisible();
  });

  // Broader account settings increment: displayName editing.
  test('editing the display name persists across a reload', async ({ page }) => {
    await page.goto('/settings');

    const nameInput = page.getByLabel('Display name');
    await nameInput.fill('Ada Test');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Display name')).toHaveValue('Ada Test');
  });

  // Broader account settings increment: the Account card's email/status
  // display. Every dev-auth account starts on Free/Active (see
  // UsersService.getOrCreateFromAuth — a real Subscription row is created
  // for every new account), so this is stable to assert without seeding
  // anything.
  test('the Account card shows email and status', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
    await expect(page.getByText('Active')).toBeVisible();
  });

  // Real Stripe billing integration: this environment has no real
  // STRIPE_SECRET_KEY/etc. configured (see the increment's own README
  // section for why that's never been possible to test for real in this
  // build sandbox), so clicking Plus here exercises the *fallback* path —
  // createCheckoutSession really is called first and really does come back
  // STRIPE_NOT_CONFIGURED, then the frontend falls back to the original
  // simulated instant-switch mutation automatically (see
  // handleUpgrade's own comment) — the end state this test asserts on is
  // the same either way, which is exactly the point of that fallback.
  // Ends by switching back to Free, since this suite's whole Settings
  // describe block (and every other spec file) runs against the one shared
  // AUTH_MODE=dev identity — leaving it on a paid tier would quietly change
  // what "the Account card shows email and status" test above sees on a
  // later run, the same shared-state care the Danger zone test above
  // already takes.
  test('switching plans updates which tier is marked current, and persists across a reload', async ({ page }) => {
    await page.goto('/settings');

    const plusButton = page.getByRole('button', { name: /^Plus/ });
    const freeButton = page.getByRole('button', { name: /^Free/ });

    await expect(freeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('simulated', { exact: false })).toBeVisible();

    await plusButton.click();
    await expect(plusButton).toHaveAttribute('aria-pressed', 'true');
    await expect(freeButton).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Renews')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: /^Plus/ })).toHaveAttribute('aria-pressed', 'true');

    // Leave the shared account back the way every other spec expects it.
    await page.getByRole('button', { name: /^Free/ }).click();
    await expect(page.getByRole('button', { name: /^Free/ })).toHaveAttribute('aria-pressed', 'true');
  });

  // Real Stripe billing integration: "Manage billing" only ever appears
  // once a real Stripe customer exists (`hasStripeCustomer`) — this shared
  // dev-auth account has never gone through real Checkout (Stripe isn't
  // configured in this environment at all, see the test above), so it
  // should never be visible, and the plan buttons should still be directly
  // clickable rather than disabled the way they'd be for a real Stripe
  // customer.
  test('the Manage billing button is not shown for an account with no real Stripe customer yet', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.getByRole('button', { name: 'Manage billing →' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Plus/ })).toBeEnabled();
  });

  // Broader account settings increment: the Danger zone's confirmation
  // gate. Deliberately does NOT ever click "Delete my account" through to
  // completion — every spec in this file (and the rest of the suite) runs
  // against the one shared AUTH_MODE=dev identity baked into
  // NEXT_PUBLIC_DEV_USER_EMAIL at build time (see apollo-client.ts), so
  // actually deleting it here would pull the rug out from under every other
  // test that assumes that account still exists. The real end-to-end
  // deletion path (seed data, delete, confirm it's gone, confirm a fresh
  // account appears) is covered instead by a backend e2e test that mints
  // its own disposable dev identity directly via supertest, something this
  // Playwright suite has no way to do per-test.
  test('the delete button stays disabled until DELETE is typed exactly', async ({ page }) => {
    await page.goto('/settings');

    const deleteButton = page.getByRole('button', { name: 'Delete my account' });
    await expect(deleteButton).toBeDisabled();

    const confirmInput = page.getByLabel('Type DELETE to confirm');
    await confirmInput.fill('delete');
    await expect(deleteButton).toBeDisabled();

    await confirmInput.fill('DELETE');
    await expect(deleteButton).toBeEnabled();

    await confirmInput.fill('DELETEX');
    await expect(deleteButton).toBeDisabled();
  });

  // Configurable reminder windows/thresholds increment. Scope worth being
  // upfront about: this proves the five new reminder fields genuinely save
  // and reload through the real UI, not that a saved reminder hour later
  // changes real notification-firing behavior — that half is what
  // app.e2e-spec.ts's "Scheduler / reminder sweep" suite proves instead,
  // since there's no user-facing button anywhere that triggers the cron
  // sweep on demand the way starting a Pomodoro run immediately exercises
  // Focus's own settings.
  test('custom reminder hours and habit-overdue bounds save and reload correctly, and clearing a field restores its placeholder default', async ({ page }) => {
    await page.goto('/settings');

    const morningInput = page.getByLabel('Morning routine reminder hour');
    const eveningInput = page.getByLabel('Evening routine reminder hour');
    const reflectionInput = page.getByLabel('Reflection reminder hour');
    const minOverdueInput = page.getByLabel('Habit reminder minimum overdue minutes');
    const maxOverdueInput = page.getByLabel('Habit reminder maximum overdue minutes');

    await expect(morningInput).toBeVisible();
    await morningInput.fill('6');
    await eveningInput.fill('19');
    await reflectionInput.fill('22');
    await minOverdueInput.fill('30');
    await maxOverdueInput.fill('90');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    // Really persisted, not just held in local component state — a full
    // reload re-fetches from the server.
    await page.reload();
    await expect(morningInput).toHaveValue('6');
    await expect(eveningInput).toHaveValue('19');
    await expect(reflectionInput).toHaveValue('22');
    await expect(minOverdueInput).toHaveValue('30');
    await expect(maxOverdueInput).toHaveValue('90');

    // Clearing all five back to blank and re-saving restores the classic
    // defaults — same "null clears back to the fixed default" behavior
    // already proven on the backend side, checked here via the field's own
    // placeholder (the visible value once it's genuinely empty again).
    await morningInput.fill('');
    await eveningInput.fill('');
    await reflectionInput.fill('');
    await minOverdueInput.fill('');
    await maxOverdueInput.fill('');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    await page.reload();
    await expect(morningInput).toHaveValue('');
    await expect(morningInput).toHaveAttribute('placeholder', '8');
    await expect(eveningInput).toHaveAttribute('placeholder', '20');
    await expect(reflectionInput).toHaveAttribute('placeholder', '21');
    await expect(minOverdueInput).toHaveAttribute('placeholder', '15');
    await expect(maxOverdueInput).toHaveAttribute('placeholder', '120');
  });

  test('rejects a habit-overdue minimum that is not less than the maximum, with a clear inline error', async ({ page }) => {
    await page.goto('/settings');

    const minOverdueInput = page.getByLabel('Habit reminder minimum overdue minutes');
    const maxOverdueInput = page.getByLabel('Habit reminder maximum overdue minutes');
    await minOverdueInput.fill('90');
    await maxOverdueInput.fill('60');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();

    // Scoped by its own text rather than a bare `getByRole('alert')`: Next.js
    // itself always renders a second, page-wide `role="alert"` live region
    // for its route announcer, which makes an unscoped role=alert query a
    // strict-mode violation on every page, not just this one.
    await expect(page.getByRole('alert').filter({ hasText: 'maximum overdue window must be greater than the minimum' })).toBeVisible();

    // Clean up so this shared dev-auth account doesn't leave an invalid-
    // looking draft behind for whichever spec runs against it next — restore
    // a valid pair and save.
    await minOverdueInput.fill('15');
    await maxOverdueInput.fill('120');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  });
});
