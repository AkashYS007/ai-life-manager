import { test, expect } from '@playwright/test';

// Smoke test — the baseline every other spec's navigation implicitly
// depends on: if Today itself can't load, nothing else in this suite would
// ever pass either, so this is worth its own fast, focused check.
test.describe('Today screen', () => {
  test('loads, greets the person, and shows the quick-add form', async ({ page }) => {
    await page.goto('/today');

    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible();
    await expect(page.getByPlaceholder('Add a task…')).toBeVisible();
  });
});
