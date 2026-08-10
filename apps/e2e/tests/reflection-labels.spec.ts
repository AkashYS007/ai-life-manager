import { test, expect } from '@playwright/test';
import { unique } from './helpers';

// Configurable daily reflection questions increment. Proves the whole round
// trip for real: a person renames the three fixed reflection questions on
// /settings, saves, navigates to /reflection, and the form's own labels
// reflect the saved custom wording instead of the classic default — the one
// thing the backend e2e coverage (updateProfile persistence, in
// app.e2e-spec.ts) can't prove on its own, since resolving which wording to
// show happens entirely client-side in apps/web/src/app/reflection/page.tsx.
// Same "custom value on Settings, verified on the concern page, then
// cleared back to the default" shape pomodoro-settings.spec.ts already
// establishes for Pomodoro durations.
test.describe('Configurable daily reflection questions', () => {
  test('custom question labels saved on Settings show up on the Reflection screen, and clearing them restores the defaults', async ({ page }) => {
    const wentWellLabel = unique('Bright spots');
    const challengingLabel = unique('Rough patches');
    const carryForwardLabel = unique('Carry into tomorrow');

    await page.goto('/settings');

    await page.getByLabel('Went well question label').fill(wentWellLabel);
    await page.getByLabel('Challenging question label').fill(challengingLabel);
    await page.getByLabel('Carry forward question label').fill(carryForwardLabel);
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    await page.goto('/reflection');

    // If today's reflection was already submitted by an earlier run against
    // this same shared dev-auth account, the page shows a read-only summary
    // with an "Edit" link instead of the form directly — same guard
    // checkin-reflection.spec.ts's own reflection test uses to reach the
    // form either way.
    const editButton = page.getByRole('button', { name: "Edit today's reflection" });
    if (await editButton.isVisible().catch(() => false)) {
      await editButton.click();
    }

    await expect(page.getByLabel(wentWellLabel)).toBeVisible();
    await expect(page.getByLabel(challengingLabel)).toBeVisible();
    await expect(page.getByLabel(carryForwardLabel)).toBeVisible();
    // The classic default wording is genuinely replaced, not just
    // supplemented — same "replaces, not adds to" proof
    // pomodoro-settings.spec.ts's own comment documents for its own fields.
    await expect(page.getByLabel('What went well today?')).toHaveCount(0);

    // Clearing all three fields back to blank and re-saving restores the
    // classic default wording — the same null-clears-back-to-default
    // behavior already proven on the backend side.
    await page.goto('/settings');
    await page.getByLabel('Went well question label').fill('');
    await page.getByLabel('Challenging question label').fill('');
    await page.getByLabel('Carry forward question label').fill('');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    await page.goto('/reflection');
    const editButtonAfterReset = page.getByRole('button', { name: "Edit today's reflection" });
    if (await editButtonAfterReset.isVisible().catch(() => false)) {
      await editButtonAfterReset.click();
    }
    await expect(page.getByLabel('What went well today?')).toBeVisible();
    await expect(page.getByLabel('What was challenging?')).toBeVisible();
    await expect(page.getByLabel('What do you want to carry into tomorrow?')).toBeVisible();
  });
});
