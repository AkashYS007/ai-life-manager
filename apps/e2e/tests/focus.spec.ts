import { test, expect } from '@playwright/test';
import { unique } from './helpers';

test.describe('Focus sessions', () => {
  test('starting a focus session shows a countdown, and completing it clears back to the start screen', async ({ page }) => {
    await page.goto('/focus');

    // If a session was left active by an earlier manual run against this
    // same dev-auth account, cancel it first — this spec only cares about a
    // clean start→complete round trip, not recovering someone else's timer.
    const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click();
    }

    await expect(page.getByRole('button', { name: /Start \d+-minute focus session/ })).toBeVisible();
    await page.getByRole('button', { name: /Start \d+-minute focus session/ }).click();

    await expect(page.getByRole('heading', { name: 'Focus session', exact: true })).toBeVisible();
    await expect(page.getByText(/of \d+ min planned/)).toBeVisible();

    await page.getByRole('button', { name: 'Complete', exact: true }).click();

    // Back to the start screen, and the just-finished session shows as
    // Done in the recent-sessions list below it.
    await expect(page.getByRole('button', { name: /Start \d+-minute focus session/ })).toBeVisible();
    await expect(page.getByText('Done', { exact: true }).first()).toBeVisible();
  });

  // Focus sessions feed task duration back increment. This is a genuinely
  // slow test (~35 real seconds of intentional waiting), on purpose — the
  // whole feature is about real elapsed wall-clock time, so there's no way
  // to prove it honestly without actually letting real time pass. `Math.
  // round` on the backend means anything past 30 real seconds already
  // rounds up to a real "1" minute (see FocusService.getCompletedMinutesForTask's
  // own comment); 35 seconds leaves a safety margin over network/mutation
  // overhead so this doesn't land right on that rounding boundary and flake.
  test('completing a task with a real completed focus session pre-fills its actual-duration prompt', async ({ page }) => {
    // The comment above already explains *why* this test waits a real 35
    // seconds; it just never raised Playwright's 30s default per-test
    // timeout to cover that wait, so a real run always timed out on its own
    // intentional delay before ever reaching the assertions past it. Same
    // fix, same reasoning as ai-plan-review.spec.ts's `test.setTimeout` —
    // margin above the longest deliberate in-test wait, not an arbitrary
    // bump.
    test.setTimeout(60_000);

    const title = unique('E2E focus-linked task');

    await page.goto('/today');
    await page.getByPlaceholder('Add a task…').fill(title);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    // Scoped to the row's own data-testid rather than any generic `div` +
    // hasText match, which can just as easily resolve to an ancestor
    // wrapper as the specific row (see the identical fix already applied
    // to habits.spec.ts/memory.spec.ts/goals.spec.ts for this same class of
    // bug).
    const row = page.locator('[data-testid^="today-task-row-"]').filter({ hasText: title });
    await row.getByRole('link', { name: 'Focus', exact: true }).click();

    await expect(page.getByText('Focusing on')).toBeVisible();
    await expect(page.getByRole('button', { name: /Start \d+-minute focus session/ })).toBeVisible();
    await page.getByRole('button', { name: /Start \d+-minute focus session/ }).click();
    // A session linked to a task shows the task's own title as its heading,
    // not the literal fallback text "Focus session" — that fallback only
    // ever renders when a session has no linked task (see FocusPage's own
    // `session.taskTitle ?? 'Focus session'`), which isn't the case here.
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();

    await page.waitForTimeout(35_000);
    await page.getByRole('button', { name: 'Complete', exact: true }).click();
    await expect(page.getByRole('button', { name: /Start \d+-minute focus session/ })).toBeVisible();

    await page.goto('/today');
    await page.getByRole('button', { name: `Mark "${title}" complete` }).click();

    const actualMinutesInput = page.getByLabel(`Actual time spent on "${title}", in minutes`);
    await expect(actualMinutesInput).not.toHaveValue('');
    await expect(actualMinutesInput).not.toHaveValue('0');
    await expect(page.getByText('From your focus sessions on this task — feel free to change it.')).toBeVisible();
  });

  // Automatic Pomodoro work/break cycling increment. Drives the cycle
  // forward with real manual "Complete"/"Skip to next" clicks rather than
  // actually waiting for the real 25-minute work timer to reach zero — that
  // path (ActiveSessionView's auto-fire-at-zero effect) calls the exact
  // same advanceCycle function a manual click does, so this still proves
  // the real cycling logic end to end; it just can't honestly prove the
  // "reaches zero on its own" trigger itself without a genuinely
  // impractical ~30-real-minute wait, which is a real, worth-stating scope
  // limit on this spec, not an oversight.
  test('Pomodoro mode automatically starts a break after a work block, then a new work block after the break', async ({ page }) => {
    await page.goto('/focus');

    const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click();
    }

    const pomodoroToggle = page.getByRole('checkbox', { name: /Pomodoro mode/ });
    await expect(pomodoroToggle).toBeVisible();
    await pomodoroToggle.check();

    // Forcing the fixed 25-minute Pomodoro work length hides the manual
    // duration presets entirely — confirms the toggle really changed the
    // start screen, not just its own checked state.
    await expect(page.getByRole('button', { name: '25 min', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Start Pomodoro/ })).toBeVisible();
    await page.getByRole('button', { name: /Start Pomodoro/ }).click();

    await expect(page.getByText('Focus block 1', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Complete', exact: true }).click();

    // The break starts automatically — no second "Start" click anywhere.
    // Scoped to the heading specifically: a plain `getByText(/Break/)` is a
    // strict-mode violation here since the break screen shows the word in
    // two places at once (the "☕ Break" heading and a "Break" status line).
    await expect(page.getByRole('heading', { name: /Break/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip to next', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip to next', exact: true }).click();

    // Back to work automatically, on the second block.
    await expect(page.getByText('Focus block 2', { exact: false })).toBeVisible();

    // Cancel always fully exits Pomodoro mode — back to the plain start
    // screen with the toggle unchecked, not mid-cycle.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: /Start \d+-minute focus session/ })).toBeVisible();
    await expect(pomodoroToggle).not.toBeChecked();
  });
});
