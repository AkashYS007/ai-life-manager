import { test, expect } from '@playwright/test';
import { unique } from './helpers';

test.describe('Routines', () => {
  test('adding a step to the morning routine on /routines shows it on Today, and it can be checked off there', async ({ page }) => {
    const step = unique('E2E routine step');

    await page.goto('/routines');

    // Scoped to the Morning routine editor specifically — the page renders
    // two near-identical RoutineEditor instances (morning and evening), each
    // with its own "New routine step" input and "Add" button.
    const morningEditor = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Morning routine' }) }).last();
    await morningEditor.getByPlaceholder('Add a step…').fill(step);
    await morningEditor.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(morningEditor.getByText(step, { exact: true })).toBeVisible();

    // "Create" the first time this account ever has a morning routine,
    // "Update" on every later save — same button either way.
    await morningEditor.getByRole('button', { name: /^(Create|Update)$/ }).click();

    await page.goto('/today');
    const checkbox = page.getByRole('button', { name: `Mark "${step}" done` });
    await expect(checkbox).toBeVisible();
    await checkbox.click();
    await expect(page.getByRole('button', { name: `Mark "${step}" not done` })).toBeVisible();
  });
});
