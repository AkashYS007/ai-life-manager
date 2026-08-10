import { test, expect } from '@playwright/test';

// Configurable Pomodoro durations increment. Proves the whole round trip for
// real: a person changes the four numbers on /settings, saves, navigates to
// /focus, and Pomodoro mode's own summary line and forced work-block length
// reflect the saved custom values — not the classic 25/5/15/4 default. This
// is the one thing the backend e2e coverage (updateProfile persistence and
// its bounds validation, in app.e2e-spec.ts) can't prove on its own, since
// the actual cadence math and labels live entirely client-side in
// apps/web/src/app/focus/page.tsx.
test.describe('Configurable Pomodoro durations', () => {
  test('custom durations saved on Settings show up in Focus Pomodoro mode, and clearing a field restores its default', async ({ page }) => {
    await page.goto('/settings');

    const workInput = page.getByLabel('Pomodoro work minutes');
    const shortBreakInput = page.getByLabel('Pomodoro short break minutes');
    const longBreakInput = page.getByLabel('Pomodoro long break minutes');
    const cyclesInput = page.getByLabel('Long break every N cycles');

    await workInput.fill('45');
    await shortBreakInput.fill('8');
    await longBreakInput.fill('20');
    await cyclesInput.fill('3');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    await page.goto('/focus');

    const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click();
    }

    // The toggle's own summary line reads the real per-user values, not the
    // hardcoded 25/5/15/4 default.
    await expect(
      page.getByText('🍅 Pomodoro mode — 45 min work · 8 min break · 20 min long break every 3th'),
    ).toBeVisible();

    const pomodoroToggle = page.getByRole('checkbox', { name: /Pomodoro mode/ });
    await pomodoroToggle.check();
    await expect(page.getByRole('button', { name: 'Start Pomodoro (45-minute blocks)', exact: true })).toBeVisible();

    // Clearing a field back to blank and re-saving restores the classic
    // default for that one field — the same "null clears back to the fixed
    // default" behavior already proven on the backend side.
    await page.goto('/settings');
    await page.getByLabel('Pomodoro work minutes').fill('');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    await page.goto('/focus');
    await expect(
      page.getByText('🍅 Pomodoro mode — 25 min work · 8 min break · 20 min long break every 3th'),
    ).toBeVisible();

    // Clean up — leave the account back at the classic defaults for any
    // other spec that runs against this same dev-auth user after this one.
    await page.goto('/settings');
    await page.getByLabel('Pomodoro short break minutes').fill('');
    await page.getByLabel('Pomodoro long break minutes').fill('');
    await page.getByLabel('Long break every N cycles').fill('');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  });
});
