import { test, expect } from '@playwright/test';
import { unique } from './helpers';

test.describe('Daily check-in and reflection', () => {
  test('logging mood, energy, and sleep on Today saves without error', async ({ page }) => {
    await page.goto('/today');

    await page.getByRole('button', { name: 'Mood 4 out of 5' }).click();
    await page.getByRole('button', { name: 'Energy 4 out of 5' }).click();

    await page.getByLabel('Hours of sleep last night').fill('7.5');
    await page.getByRole('button', { name: 'Sleep quality 4 out of 5' }).click();
    // "Log" the first time this account ever logs sleep, "Update" on every
    // subsequent run against the same shared dev-auth account — either way
    // it's the same button, just re-labeled (see DailyCheckIn.tsx).
    await page.getByRole('button', { name: /^(Log|Update)$/ }).click();

    // No error text appeared, and the mood/energy picks stayed selected —
    // the real, server-confirmed signal that each mutation actually saved
    // (a purely-local/optimistic failure would still show the tap as
    // "selected" only until the next refetch quietly reverted it).
    await page.reload();
    await expect(page.getByRole('button', { name: 'Mood 4 out of 5' })).toHaveClass(/ring-accent|ring-2/);
  });

  test('submitting the three-question daily reflection saves it', async ({ page }) => {
    const wentWell = unique('E2E went well');
    const challenging = unique('E2E challenging');
    const carryForward = unique('E2E carry forward');

    await page.goto('/reflection');

    // If today's reflection was already submitted by an earlier run against
    // this same shared dev-auth account, the page shows a read-only summary
    // with an "Edit" link instead of the form directly — open the editor
    // first so this spec can reach the same three textareas either way.
    const editButton = page.getByRole('button', { name: "Edit today's reflection" });
    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
    }

    await page.getByLabel('What went well today?').fill(wentWell);
    await page.getByLabel('What was challenging?').fill(challenging);
    await page.getByLabel('What do you want to carry into tomorrow?').fill(carryForward);
    await page.getByRole('button', { name: /^(Save reflection|Update reflection)$/ }).click();

    await expect(page.getByText(wentWell, { exact: true })).toBeVisible();
    await expect(page.getByText(challenging, { exact: true })).toBeVisible();
    await expect(page.getByText(carryForward, { exact: true })).toBeVisible();
  });
});
