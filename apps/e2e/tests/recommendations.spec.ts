import { test, expect, type Page } from '@playwright/test';

// AiRecommendationsCard renders a real, named error (`role="alert"`,
// data-testid="recommendations-error") inline instead of navigating
// whenever actOnRecommendation's mutation comes back with a genuine backend
// rejection (RecommendationNotFoundError, RecommendationAlreadyHandledError,
// FocusSessionAlreadyActiveError, or a generic ACT_FAILED) — which
// otherwise shows up here as a bare "expected URL to change, timed out"
// failure with no indication of why. Checked right after every commit
// click, this turns that into a precise, readable failure instead, whatever
// the actual cause turns out to be.
//
// Scoped to the card's own `data-testid`, not a page-wide `getByRole
// ('alert')`: a first real run of this check caught an empty-string
// "error" — /today has its *own* top-level `role="alert"` for a failed
// TODAY_PLAN_QUERY (see today/page.tsx), and acting on a recommendation
// refetches that exact query as part of committing the action, so a
// page-wide alert selector isn't guaranteed to be *this* card's error at
// all. Added the testid to AiRecommendationsCard itself rather than keep
// guessing at which alert a bare role-based selector actually caught.
async function failOnActionError(page: Page): Promise<void> {
  const alertBanner = page.getByTestId('recommendations-error');
  const sawError = await alertBanner
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (sawError) {
    const message = await alertBanner.textContent();
    throw new Error(
      `actOnRecommendation returned an error instead of committing the action: "${message}". If this mentions an already-active focus session, this shared dev-auth account had one left over from an earlier run that the cleanup at the top of this test didn't catch.`,
    );
  }
}

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
    // Same reasoning as ai-plan-review.spec.ts's own test.setTimeout: this
    // test's own inner 30s waits for a real AI call are each within
    // Playwright's default per-test 30s budget on their own, but the test
    // overall needs multiple sequential steps (get recommendations, act on
    // one, navigate, verify) to all fit inside it — the outer test timeout
    // was cutting this off before a genuinely-in-flight AI call and its
    // follow-on steps could finish, independent of any single expect's own
    // timeout being generous enough.
    test.setTimeout(90_000);

    // A BREAK recommendation's action button starts a real focus session
    // (see AiRecommendationsCard.handleAct → FocusService.start), which
    // throws a real, named FocusSessionAlreadyActiveError — surfaced here
    // as an inline error banner, not a crash — if this shared dev-auth
    // account (see playwright.config.ts's own comment on why there's no
    // per-test isolation) already has one left active from an earlier run
    // that didn't clean up after itself. Same defensive cleanup
    // focus.spec.ts's own tests already do before starting a new session,
    // done here too since this spec can just as easily land on the BREAK
    // branch and hit the exact same guard.
    await page.goto('/focus');
    const preExistingCancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
    if (await preExistingCancelButton.isVisible().catch(() => false)) {
      await preExistingCancelButton.click();
    }

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
    await failOnActionError(page);

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
    // Same reasoning as the test above.
    test.setTimeout(90_000);

    // Same defensive cleanup as the test above, and for the exact same
    // reason: this spec can equally land on the BREAK branch below, which
    // hits the real FocusSessionAlreadyActiveError guard if a session was
    // left active by an earlier run on this shared dev-auth account.
    await page.goto('/focus');
    const preExistingCancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
    if (await preExistingCancelButton.isVisible().catch(() => false)) {
      await preExistingCancelButton.click();
    }

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
      await failOnActionError(page);
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
      await failOnActionError(page);
      await expect(page).toHaveURL(/\/calendar/, { timeout: 15_000 });
    } else {
      await page.getByRole('button', { name: /Confirm & take this break/ }).click();
      await failOnActionError(page);
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
