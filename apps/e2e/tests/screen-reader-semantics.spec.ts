import { test, expect } from '@playwright/test';
import { unique } from './helpers';

// Screen-reader pass increment. The axe-core scan in accessibility.spec.ts
// (and its own comment) is explicit about what it structurally can't catch:
// missing ARIA *state* (aria-pressed/aria-selected reflecting which of
// several toggle-style controls is actually active) isn't something a
// static DOM scan flags as a violation — a button with no aria-pressed at
// all is perfectly valid HTML, axe has no rule saying a toggle must expose
// its state. Playwright's role-aware locators (`getByRole(..., { pressed
// }/{ selected })`) query the same computed accessibility tree a real
// screen reader reads from, so these assertions are a genuine (if not
// literally audio-verified — see the increment's own README section for
// that honest caveat) check that the state a sighted person sees via color
// is also exposed to assistive technology.
test.describe('Screen-reader semantics (ARIA state)', () => {
  test('the Tasks screen tab control exposes aria-selected, not just color', async ({ page }) => {
    await page.goto('/tasks');

    const openTab = page.getByRole('tab', { name: 'Open' });
    const cancelledTab = page.getByRole('tab', { name: 'Cancelled' });
    await expect(openTab).toHaveAttribute('aria-selected', 'true');
    await expect(cancelledTab).toHaveAttribute('aria-selected', 'false');

    await cancelledTab.click();
    await expect(cancelledTab).toHaveAttribute('aria-selected', 'true');
    await expect(openTab).toHaveAttribute('aria-selected', 'false');
  });

  test('the Goals screen tab control exposes aria-selected, not just color', async ({ page }) => {
    await page.goto('/goals');

    const activeTab = page.getByRole('tab', { name: 'Active' });
    const completedTab = page.getByRole('tab', { name: 'Completed' });
    await expect(activeTab).toHaveAttribute('aria-selected', 'true');

    await completedTab.click();
    await expect(completedTab).toHaveAttribute('aria-selected', 'true');
    await expect(activeTab).toHaveAttribute('aria-selected', 'false');
  });

  test('completing a habit on Today flips its checkbox\'s aria-pressed state', async ({ page }) => {
    const title = unique('E2E a11y habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'Add habit' }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    await page.goto('/today');
    const doneButton = page.getByRole('button', { name: `Mark "${title}" done` });
    await expect(doneButton).toHaveAttribute('aria-pressed', 'false');

    await doneButton.click();
    // The label swaps to "not done" once completed (see HabitRow.tsx) —
    // re-locate by the new accessible name and confirm it now reports
    // pressed too, not just a re-colored checkbox.
    const notDoneButton = page.getByRole('button', { name: `Mark "${title}" not done` });
    await expect(notDoneButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('logging a mood check-in on Today flips that score\'s aria-pressed state', async ({ page }) => {
    await page.goto('/today');

    const moodThree = page.getByRole('button', { name: 'Mood 3 out of 5' });
    await moodThree.click();
    await expect(moodThree).toHaveAttribute('aria-pressed', 'true');

    // Logging a different score moves the pressed state, not just the
    // visual ring — ScorePicker's own comment explains why this is
    // role="group" + aria-pressed rather than a full ARIA radio-group.
    const moodFive = page.getByRole('button', { name: 'Mood 5 out of 5' });
    await moodFive.click();
    await expect(moodFive).toHaveAttribute('aria-pressed', 'true');
    await expect(moodThree).toHaveAttribute('aria-pressed', 'false');
  });
});
