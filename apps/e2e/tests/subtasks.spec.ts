import { test, expect } from '@playwright/test';
import { unique } from './helpers';

test.describe('Subtasks', () => {
  test('adding a subtask, completing it, and removing it all update the parent task correctly', async ({ page }) => {
    const parentTitle = unique('E2E subtask parent');
    const subtaskTitle = unique('E2E subtask');

    await page.goto('/today');
    await page.getByPlaceholder('Add a task…').fill(parentTitle);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(parentTitle, { exact: true })).toBeVisible();

    await page.goto('/tasks');
    // Pinned to the row's stable data-testid rather than kept as a
    // `hasText` filter: once Edit is clicked, the title moves into an
    // <input value="...">, which isn't part of an element's text content,
    // so a `hasText` locator that matched the view-mode row would silently
    // stop matching the same row in edit mode (see TaskEditRow's identical
    // gotcha, fixed the same way in tasks.spec.ts).
    const initialRow = page.locator('[data-testid^="task-row-"]').filter({ hasText: parentTitle });
    const testId = await initialRow.getAttribute('data-testid');
    const row = page.locator(`[data-testid="${testId}"]`);

    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    // Editing collapses the row into the edit form (no Subtasks section
    // there — see TaskEditRow's own comment on why); save with no changes
    // to get back to the view state where SubtaskList actually renders.
    await row.getByRole('button', { name: 'Save', exact: true }).click();

    const addSubtaskInput = row.getByLabel(`Add a subtask to "${parentTitle}"`);
    await addSubtaskInput.fill(subtaskTitle);
    await row.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(row.getByText(subtaskTitle, { exact: true })).toBeVisible();
    await expect(row.getByText('0/1', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: `Mark "${subtaskTitle}" done` }).click();
    await expect(row.getByText('1/1', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: `Mark "${subtaskTitle}" not done` })).toBeVisible();

    // The parent's own collapsed row (found on the Today screen, where the
    // full SubtaskList isn't rendered) also reflects the same count via
    // TaskRow's lightweight read-only badge — a second, independent
    // confirmation that this really persisted server-side rather than
    // being a local-only change to the editor's own state.
    await page.goto('/today');
    await expect(page.getByText('1/1 subtasks', { exact: true })).toBeVisible();

    await page.goto('/tasks');
    // Same stable-testid `row` locator from above still applies — it's the
    // same page, just reloaded, and the task's id (and therefore its
    // data-testid) hasn't changed.
    await row.getByRole('button', { name: `Remove subtask "${subtaskTitle}"` }).click();
    await expect(row.getByText(subtaskTitle, { exact: true })).not.toBeVisible();
  });
});
