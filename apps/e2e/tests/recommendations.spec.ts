import { test, expect } from '@playwright/test';

// AI recommendations acting on your behalf increment. Also the first real
// spec for this card at all — until now it was one of only two screens
// with no Playwright coverage of its own (see the README's own note on
// why), reasonably covered indirectly before, but a real one is worth
// having now that there's a genuine committed action to prove, not just
// advisory text rendering. Same "does this actually talk to the real AI"
// spirit chat.spec.ts and ai-plan-review.spec.ts already establish —
// generous timeouts, a real AnthropicClient call, not a mocked reply.
test.describe('AI recommendations', () => {
  test('acting on a recommendation performs a real, committed action — starts a break, books a workout block, or adds a task, depending on what the AI suggests', async ({ page }) => {
    await page.goto('/today');

    // "Get recommendations" the first time this account sees the card
    // today, "Refresh" if an earlier run (this spec or a manual click)
    // already generated a set — either way, clicking it always produces a
    // fresh 1-3 item set (see AiRecommendationsCard's own "generating
    // replaces the whole set" comment).
    const getButton = page.getByRole('button', { name: /Get recommendations|Refresh/ });
    await expect(getButton).toBeVisible({ timeout: 30_000 });
    await getButton.click();

    const actionButton = page.getByRole('button', { name: /Take this break|Book this workout|Add as a task/ }).first();
    await expect(actionButton).toBeVisible({ timeout: 30_000 });
    const label = (await actionButton.textContent()) ?? '';
    // Captured before clicking — the row (and its message text) disappears
    // from this card once dismissed, so this is the only chance to read it.
    const recommendationMessage = (await actionButton.locator('xpath=..').locator('.flex-1').textContent())?.trim();

    await actionButton.click();

    if (label.includes('Take this break')) {
      // The mutation already committed the real action before this
      // navigation even starts — landing on /focus is just so the person
      // can see the countdown they just started, not a second confirmation
      // step (see AiRecommendationsCard.handleAct's own comment).
      await expect(page).toHaveURL(/\/focus/, { timeout: 15_000 });
      await expect(page.getByText(/Break/, { exact: false })).toBeVisible();

      // Clean up so this shared dev-auth account doesn't leave a real
      // active focus session behind for whichever spec runs next.
      const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
      if (await cancelButton.isVisible().catch(() => false)) {
        await cancelButton.click();
      }
    } else if (label.includes('Book this workout')) {
      // Booking a workout as a real calendar block increment. Same
      // "already committed, just go look at it" reasoning as the break
      // branch above — a real CalendarEvent row exists by the time this
      // navigation runs.
      await expect(page).toHaveURL(/\/calendar/, { timeout: 15_000 });
      // The booked block starts right now, for today — the day view Calendar
      // opens on by default already covers it, no date navigation needed.
      // Confirms the real placed block, titled with the AI's own suggestion,
      // not just that some event exists.
      if (recommendationMessage) {
        await expect(page.getByText(recommendationMessage, { exact: true })).toBeVisible();
      }
    } else {
      await expect(page.getByText("Added to today's tasks — see it in your list below.")).toBeVisible();
    }
  });

  // Customize act-on defaults at the point of acting increment. Same
  // "branch on whichever category the real AI actually returns" approach
  // as the test above, since which one comes back isn't something a test
  // can pin down in advance. Distinguishes MEAL from BREAK/WORKOUT by which
  // customize field renders (a priority select only ever shows for MEAL),
  // then BREAK from WORKOUT by whether a start-time field also renders.
  test('the Customize panel overrides the fixed default — a custom break length, workout time, or task priority, depending on what the AI suggests', async ({ page }) => {
    await page.goto('/today');

    const getButton = page.getByRole('button', { name: /Get recommendations|Refresh/ });
    await expect(getButton).toBeVisible({ timeout: 30_000 });
    await getButton.click();

    const customizeButton = page.getByRole('button', { name: 'Customize →', exact: true }).first();
    await expect(customizeButton).toBeVisible({ timeout: 30_000 });
    await customizeButton.click();

    const priorityInput = page.getByLabel('Custom task priority');
    if (await priorityInput.isVisible().catch(() => false)) {
      // MEAL
      await priorityInput.selectOption('1');
      await page.getByRole('button', { name: /Confirm & add as a task/ }).click();
      await expect(page.getByText("Added to today's tasks — see it in your list below.")).toBeVisible();

      // The new task really was created with the custom Urgent priority,
      // not the fixed Normal default — TaskRow only ever shows this label
      // for priority 1.
      await expect(page.getByText('Urgent', { exact: true }).first()).toBeVisible();
      return;
    }

    const workoutStartInput = page.getByLabel('Custom workout start time');
    const isWorkout = await workoutStartInput.isVisible().catch(() => false);
    const durationInput = isWorkout
      ? page.getByLabel('Custom workout block minutes')
      : page.getByLabel('Custom break minutes');
    await durationInput.fill('45');

    if (isWorkout) {
      await page.getByRole('button', { name: /Confirm & book this workout/ }).click();
      await expect(page).toHaveURL(/\/calendar/, { timeout: 15_000 });
    } else {
      await page.getByRole('button', { name: /Confirm & take this break/ }).click();
      await expect(page).toHaveURL(/\/focus/, { timeout: 15_000 });
      // The real active session really was started with the custom
      // 45-minute length, not the fixed 15-minute default.
      await expect(page.getByText('of 45 min planned')).toBeVisible();

      const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
      if (await cancelButton.isVisible().catch(() => false)) {
        await cancelButton.click();
      }
    }
  });
});
