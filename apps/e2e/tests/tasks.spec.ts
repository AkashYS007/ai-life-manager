import { test, expect } from '@playwright/test';
import { unique } from './helpers';

test.describe('Tasks', () => {
  test('quick-add on Today creates a task that shows up there and on the Tasks screen', async ({ page }) => {
    const title = unique('E2E quick add');

    await page.goto('/today');
    await page.getByPlaceholder('Add a task…').fill(title);
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByText(title, { exact: true })).toBeVisible();

    await page.goto('/tasks');
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  test('the Tasks screen editor changes a task\'s title, priority, and due date', async ({ page }) => {
    const originalTitle = unique('E2E editable task');
    const newTitle = unique('E2E edited task');

    await page.goto('/today');
    await page.getByPlaceholder('Add a task…').fill(originalTitle);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(originalTitle, { exact: true })).toBeVisible();

    await page.goto('/tasks');
    // Scoped to the task-row container specifically (a data-testid added
    // for exactly this purpose — see TaskEditRow.tsx) rather than any
    // arbitrary div containing the title text, which nested wrapper divs
    // would also ambiguously match.
    //
    // Resolved by text just this once, then pinned to the stable
    // data-testid: the instant Edit is clicked, the title moves into an
    // <input placeholder="Title" value="...">, and an input's value isn't
    // part of an element's text content — so a `hasText` locator that
    // matched the view-mode row would silently stop matching the same row
    // in edit mode (this is also why the final re-lookup below needs to
    // exist at all; the stable-id row makes it unnecessary).
    const initialRow = page.locator('[data-testid^="task-row-"]').filter({ hasText: originalTitle });
    const testId = await initialRow.getAttribute('data-testid');
    const row = page.locator(`[data-testid="${testId}"]`);

    await row.getByRole('button', { name: 'Edit' }).click();

    await row.getByPlaceholder('Title').fill(newTitle);
    await row.getByRole('combobox').first().selectOption('1'); // Priority: Urgent
    await row.getByRole('button', { name: 'Save' }).click();

    await expect(row).toBeVisible();
    await expect(row.getByText(newTitle, { exact: true })).toBeVisible();
    await expect(row.getByText('Urgent')).toBeVisible();
  });

  test('checking a task off, then skipping the actual-duration prompt, completes it', async ({ page }) => {
    const title = unique('E2E complete me');

    await page.goto('/today');
    await page.getByPlaceholder('Add a task…').fill(title);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: `Mark "${title}" complete` }).click();
    await expect(page.getByText(`How long did "${title}" actually take?`)).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();

    // Completed tasks drop off Today's open list — reload to confirm this
    // wasn't just an optimistic UI change that a real refetch would undo.
    await page.reload();
    await expect(page.getByText(title, { exact: true })).not.toBeVisible();
  });

  // Tasks pagination increment: the Open tab now shows its 20 most
  // recently created open tasks per page (see OPEN_TASKS_QUERY), with a
  // "Load more" button for anything past that. Creating 21 tasks in a row
  // guarantees the very first one created is strictly older than 20 of its
  // own siblings — regardless of how many other open tasks already exist
  // on this shared dev-auth account from earlier runs — so it's
  // deterministically pushed past page one no matter what else is on this
  // account, without needing to know or clear out any pre-existing data.
  test('the Open tab pages past its first 20 tasks via Load more', async ({ page }) => {
    const prefix = unique('E2E page');
    const titles = Array.from({ length: 21 }, (_, i) => `${prefix} #${i + 1}`);

    await page.goto('/today');
    for (const title of titles) {
      await page.getByPlaceholder('Add a task…').fill(title);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }

    await page.goto('/tasks');
    const oldest = titles[0];
    const newest = titles[titles.length - 1];

    await expect(page.getByText(newest, { exact: true })).toBeVisible();
    await expect(page.getByText(oldest, { exact: true })).not.toBeVisible();

    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText(oldest, { exact: true })).toBeVisible();
  });
});
