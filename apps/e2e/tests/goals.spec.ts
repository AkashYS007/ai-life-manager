import { test, expect } from '@playwright/test';
import { unique } from './helpers';
import { DEV_USER_EMAIL, BACKEND_GRAPHQL_URL } from '../global-setup';

test.describe('Goals', () => {
  test('creating a goal shows it under Active, and marking it complete moves it to Completed', async ({ page }) => {
    const title = unique('E2E goal');

    await page.goto('/goals');
    await page.getByRole('button', { name: '+ New goal' }).click();
    await page.getByPlaceholder('Goal title…').fill(title);
    await page.getByRole('button', { name: 'Create goal' }).click();

    await expect(page.getByText(title, { exact: true })).toBeVisible();

    // Scoped to this goal's own card via its data-testid — a generic `div`
    // + hasText filter is ambiguous once there's more than a couple of
    // goals on the shared dev-auth account, since it can resolve to an
    // ancestor wrapper div as easily as the specific card (see the same
    // fix already applied to habits.spec.ts/memory.spec.ts for the
    // identical class of bug).
    const card = page.locator('[data-testid^="goal-card-"]').filter({ hasText: title });
    await card.getByRole('button', { name: 'Mark complete' }).click();

    // The goal drops off the Active tab once its status changes.
    await expect(page.getByText(title, { exact: true })).not.toBeVisible();

    // The status switcher renders as a real ARIA tablist (`role="tab"`), not
    // plain buttons — `getByRole('button', ...)` here matched nothing and
    // hung for the full 30s test timeout waiting for an element that could
    // never appear.
    await page.getByRole('tab', { name: 'Completed', exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  // Goal progress view increment: a freshly created goal has nothing
  // linked to it yet, so the card should show the plain nudge text, not a
  // confusing "0 of 0 tasks done."
  test('a freshly created goal with no linked tasks shows the "no tasks linked" nudge, not a progress bar', async ({ page }) => {
    const title = unique('E2E empty goal');

    await page.goto('/goals');
    await page.getByRole('button', { name: '+ New goal' }).click();
    await page.getByPlaceholder('Goal title…').fill(title);
    await page.getByRole('button', { name: 'Create goal' }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    const card = page.locator('[data-testid^="goal-card-"]').filter({ hasText: title });
    await expect(card.getByText(/No tasks linked yet/)).toBeVisible();
    await expect(card.getByRole('progressbar')).not.toBeVisible();
  });

  // Linking a real task to a real goal from Today's quick-add box, then
  // completing it, and confirming the goal's own progress text and bar
  // both update — the full path this increment's backend counts depend on,
  // not just the "0 tasks" empty state above.
  test('linking a task to a goal and completing it updates the goal\'s progress to "1 of 1 done"', async ({ page }) => {
    const goalTitle = unique('E2E tracked goal');
    const taskTitle = unique('E2E goal-linked task');

    await page.goto('/goals');
    await page.getByRole('button', { name: '+ New goal' }).click();
    await page.getByPlaceholder('Goal title…').fill(goalTitle);
    await page.getByRole('button', { name: 'Create goal' }).click();
    await expect(page.getByText(goalTitle, { exact: true })).toBeVisible();

    await page.goto('/today');
    await page.getByPlaceholder('Add a task…').fill(taskTitle);
    await page.getByLabel('Link to goal').selectOption({ label: goalTitle });
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: `Mark "${taskTitle}" complete` }).click();
    await expect(page.getByText(`How long did "${taskTitle}" actually take?`)).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();

    await page.goto('/goals');
    const card = page.locator('[data-testid^="goal-card-"]').filter({ hasText: goalTitle });
    await expect(card.getByText('1 of 1 task done')).toBeVisible();
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });

  // Linking habits to goals increment: linkedHabitCount is a plain count,
  // shown separately from the task progress line (habits have no terminal
  // "done" state, so they don't fit the "N of M done" framing) — and not
  // shown at all until a real habit is actually linked, matching the
  // no-tasks-linked nudge's "don't show a confusing zero" precedent.
  test('linking a habit to a goal updates the goal card to show "1 habit linked"', async ({ page, request }) => {
    const goalTitle = unique('E2E habit-count goal');
    const habitTitle = unique('E2E count-linked habit');

    await page.goto('/goals');
    await page.getByRole('button', { name: '+ New goal' }).click();
    await page.getByPlaceholder('Goal title…').fill(goalTitle);
    await page.getByRole('button', { name: 'Create goal' }).click();
    await expect(page.getByText(goalTitle, { exact: true })).toBeVisible();

    // This "before" precondition used to assert against the rendered DOM
    // (waiting for `networkidle`, then checking the card had no "N habit(s)
    // linked" text) on the theory that GoalsPage's `cache-and-network`
    // fetch was racing CreateGoal's own `refetchQueries`. That theory
    // didn't hold up: re-investigated again (2026-08-15, after a *second*
    // real suite run still flaked here even with the `networkidle` wait in
    // place) via two independent live reproductions — one hitting the
    // GraphQL API directly, one clicking through the real "+ New goal" UI
    // — and a freshly created goal reliably renders with zero habit-linked
    // text either way, no race observed. Rather than keep chasing a DOM
    // timing window that may not even be the real cause, this asks the
    // backend directly for this exact goal's real `linkedHabitCount` —
    // the same source of truth GoalsPage itself renders from — which
    // removes any dependency on render/network timing entirely, whatever
    // was actually behind the two flakes.
    const before = await request.post(BACKEND_GRAPHQL_URL, {
      headers: { 'x-dev-user-email': DEV_USER_EMAIL, 'content-type': 'application/json' },
      data: { query: `query { goals(status: ACTIVE) { id title linkedHabitCount } }` },
    });
    const beforeGoals = (await before.json()).data.goals as Array<{
      id: string;
      title: string;
      linkedHabitCount: number;
    }>;
    const createdGoal = beforeGoals.find((g) => g.title === goalTitle);
    expect(createdGoal, `expected to find the just-created goal "${goalTitle}" in the active goals list`).toBeTruthy();
    expect(createdGoal?.linkedHabitCount).toBe(0);

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(habitTitle);
    await page.getByLabel('Link to goal').selectOption({ label: goalTitle });
    await page.getByRole('button', { name: 'Add habit' }).click();
    await expect(page.getByText(habitTitle, { exact: true })).toBeVisible();

    await page.goto('/goals');
    const cardAfter = page.locator('[data-testid^="goal-card-"]').filter({ hasText: goalTitle });
    await expect(cardAfter.getByText('1 habit linked')).toBeVisible();
  });
});
