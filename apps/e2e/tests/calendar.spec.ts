import { test, expect } from '@playwright/test';
import { unique } from './helpers';

test.describe('Calendar', () => {
  test('quick-adding an event on Calendar shows it in the day view', async ({ page }) => {
    const title = unique('E2E calendar event');

    await page.goto('/calendar');
    await page.getByPlaceholder('Add an event…').fill(title);
    // Leave the default 09:00/30m — this spec only cares that a plain
    // native event round-trips to the day view, not any particular time.
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByText(title, { exact: true })).toBeVisible();

    // Confirms this wasn't just an optimistic UI addition — reload and
    // re-fetch from the server.
    await page.reload();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  // Push-edits-back increment: this only exercises the NATIVE path — a
  // real end-to-end check of the Google/Microsoft push itself would need
  // real OAuth credentials this sandbox (and this suite's shared dev-auth
  // account) has no way to obtain, so it isn't attempted here. What this
  // does confirm is real and load-bearing either way: the editor renders,
  // saves, and the change survives a reload — the exact same
  // `updateCalendarEvent` mutation a synced event's edit goes through too,
  // just without a real provider on the other end of it in this suite.
  test('editing a native event\'s title and time on Calendar persists', async ({ page }) => {
    const originalTitle = unique('E2E editable event');
    const newTitle = unique('E2E edited event');

    await page.goto('/calendar');
    await page.getByPlaceholder('Add an event…').fill(originalTitle);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(originalTitle, { exact: true })).toBeVisible();

    // Pinned to the row's stable data-testid rather than kept as a
    // `hasText` filter: once Edit is clicked, the title moves into an
    // <input value="...">, which isn't part of an element's text content,
    // so a `hasText` locator that matched the view-mode row would silently
    // stop matching the same row in edit mode (see HabitManageRow's
    // identical gotcha, fixed the same way in habits.spec.ts).
    const initialRow = page.locator('[data-testid^="calendar-event-"]').filter({ hasText: originalTitle });
    const testId = await initialRow.getAttribute('data-testid');
    const row = page.locator(`[data-testid="${testId}"]`);

    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await row.getByLabel('Event title').fill(newTitle);
    await row.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText(newTitle, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText(newTitle, { exact: true })).toBeVisible();
  });
});
