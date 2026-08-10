import { test, expect } from '@playwright/test';
import { unique } from './helpers';

test.describe('Journal', () => {
  test('writing an entry shows it in the list, and editing it updates the text', async ({ page }) => {
    const content = unique('E2E journal entry');
    const editedContent = unique('E2E edited journal entry');

    await page.goto('/journal');
    await page.getByPlaceholder("Write whatever's on your mind…").fill(content);
    await page.getByRole('button', { name: 'Save entry' }).click();

    await expect(page.getByText(content, { exact: true })).toBeVisible();

    // Edit it in place — scoped to the entry's own container (a
    // data-testid added for exactly this purpose, see JournalEntryRow in
    // journal/page.tsx) rather than any arbitrary div containing the text.
    //
    // Resolved by text just this once, then pinned to the stable
    // data-testid: once Edit is clicked, the content moves into a
    // controlled <textarea value="...">, and a controlled textarea's value
    // isn't rendered as a child text node — so it's not part of the
    // element's text content, and a `hasText` locator that matched the
    // view-mode row would silently stop matching the same row in edit mode.
    const initialEntry = page.locator('[data-testid^="journal-entry-"]').filter({ hasText: content });
    const testId = await initialEntry.getAttribute('data-testid');
    const entry = page.locator(`[data-testid="${testId}"]`);

    await entry.getByRole('button', { name: 'Edit' }).click();
    await entry.getByRole('textbox').fill(editedContent);
    await entry.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText(editedContent, { exact: true })).toBeVisible();
  });
});
