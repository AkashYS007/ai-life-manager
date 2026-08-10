import { test, expect } from '@playwright/test';
import { unique } from './helpers';

test.describe('AI Memory', () => {
  test('adding a memory fact shows it in the list, and editing it updates the text', async ({ page }) => {
    const content = unique('E2E memory fact');
    const editedContent = unique('E2E edited memory fact');

    await page.goto('/memory');
    await page.getByLabel('New memory fact').fill(content);
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByText(content, { exact: true })).toBeVisible();

    // Scoped to this fact's own row (matched by its current text) rather
    // than any arbitrary row, since every other fact on this shared
    // dev-auth account has its own identical "Edit"/"Remove" buttons.
    //
    // Resolved by text just this once, while still in view mode, then
    // pinned to the row's stable data-testid for everything after: once
    // Edit is clicked, the content moves into an <input value="...">, and
    // an input's value isn't part of an element's text content — so a
    // `hasText`-based locator that matched the view-mode row silently stops
    // matching the exact same row the moment it switches to edit mode
    // (re-resolves to zero elements, hanging every subsequent action until
    // timeout, rather than erroring).
    const initialRow = page.locator('[data-testid^="memory-fact-row-"]').filter({ hasText: content }).last();
    const testId = await initialRow.getAttribute('data-testid');
    const row = page.locator(`[data-testid="${testId}"]`);

    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await row.getByLabel('Edit memory fact').fill(editedContent);
    await row.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText(editedContent, { exact: true })).toBeVisible();
  });
});
