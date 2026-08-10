import { test, expect } from '@playwright/test';
import { unique } from './helpers';

test.describe('Habits', () => {
  test('creating a daily habit and a specific-days habit both show up in the list', async ({ page }) => {
    const dailyTitle = unique('E2E daily habit');
    const weeklyTitle = unique('E2E weekly habit');

    await page.goto('/habits');

    await page.getByPlaceholder('New habit…').fill(dailyTitle);
    await page.getByRole('button', { name: 'Add habit' }).click();
    await expect(page.getByText(dailyTitle, { exact: true })).toBeVisible();

    await page.getByPlaceholder('New habit…').fill(weeklyTitle);
    await page.getByRole('button', { name: 'Specific days' }).click();
    // Toggle Monday and Wednesday on before submitting — the "Add habit"
    // button stays disabled until at least one day is picked for a WEEKLY
    // habit (see CreateHabitForm's own disabled condition).
    await page.getByRole('button', { name: 'Mon', exact: true }).click();
    await page.getByRole('button', { name: 'Wed', exact: true }).click();
    await page.getByRole('button', { name: 'Add habit' }).click();

    await expect(page.getByText(weeklyTitle, { exact: true })).toBeVisible();
  });

  // Linking habits to goals increment: the goal picker only appears once a
  // real ACTIVE goal exists (mirrors QuickAddTask's identical picker), and
  // once a habit is linked at creation time, its row should show the
  // goal's title. (Habit-edit UI increment: that link is no longer
  // create-time-only — see the editing test below for changing it
  // afterward.)
  test('linking a habit to a goal at creation time shows the goal title on its row', async ({ page }) => {
    const goalTitle = unique('E2E habit-linked goal');
    const habitTitle = unique('E2E linked habit');

    await page.goto('/goals');
    await page.getByRole('button', { name: '+ New goal' }).click();
    await page.getByPlaceholder('Goal title…').fill(goalTitle);
    await page.getByRole('button', { name: 'Create goal' }).click();
    await expect(page.getByText(goalTitle, { exact: true })).toBeVisible();

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(habitTitle);
    await page.getByLabel('Link to goal').selectOption({ label: goalTitle });
    await page.getByRole('button', { name: 'Add habit' }).click();

    const row = page.locator('div').filter({ hasText: habitTitle }).last();
    await expect(row.getByText(goalTitle, { exact: true })).toBeVisible();
  });

  // Full custom habit recurrence increment: each of these exercises a real
  // rrule shape end to end (form → createHabit → HabitsService.toGraphHabit
  // → HabitManageRow's recurrenceLabel), asserting the exact human-readable
  // label that shape produces — not just that the row exists.
  test('creating an "every N days" habit shows the right label on its row', async ({ page }) => {
    const title = unique('E2E every-3-days habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    // "Every day" (DAILY) is already selected by default — only the
    // interval needs changing.
    await page.getByLabel('Repeat every N days').fill('3');
    await page.getByRole('button', { name: 'Add habit' }).click();

    const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).last();
    await expect(row.getByText('Every 3 days', { exact: true })).toBeVisible();
  });

  test('creating an "every N weeks" habit shows the right label on its row', async ({ page }) => {
    const title = unique('E2E every-2-weeks habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'Specific days' }).click();
    await page.getByRole('button', { name: 'Mon', exact: true }).click();
    await page.getByRole('button', { name: 'Wed', exact: true }).click();
    await page.getByLabel('Repeat every N weeks').fill('2');
    await page.getByRole('button', { name: 'Add habit' }).click();

    const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).last();
    await expect(row.getByText('Every 2 weeks: Mon, Wed', { exact: true })).toBeVisible();
  });

  test('creating a monthly "day of the month" habit shows the right label on its row', async ({ page }) => {
    const title = unique('E2E monthly-day-15 habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'Monthly' }).click();
    // "A day of the month" is the default monthlyMode once Monthly is
    // picked — only the day itself needs setting.
    await page.getByLabel('Day of the month').fill('15');
    await page.getByRole('button', { name: 'Add habit' }).click();

    const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).last();
    await expect(row.getByText('Monthly on the 15th', { exact: true })).toBeVisible();
  });

  test('the "last day of the month" checkbox produces the right label, and disables the day number field', async ({ page }) => {
    const title = unique('E2E monthly-last-day habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'Monthly' }).click();
    await page.getByLabel('Always use whichever day is last in that month, instead of a fixed number').check();
    await expect(page.getByLabel('Day of the month')).toBeDisabled();
    await page.getByRole('button', { name: 'Add habit' }).click();

    const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).last();
    await expect(row.getByText('Monthly on the last day', { exact: true })).toBeVisible();
  });

  test('creating a monthly "specific weekday" habit shows the right label on its row', async ({ page }) => {
    const title = unique('E2E monthly-3rd-tuesday habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'Monthly' }).click();
    await page.getByRole('button', { name: 'A specific weekday' }).click();
    await page.getByLabel('Which occurrence of the month').selectOption({ label: 'third' });
    await page.getByLabel('Weekday').selectOption({ label: 'Tuesday' });
    await page.getByRole('button', { name: 'Add habit' }).click();

    const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).last();
    await expect(row.getByText('Monthly, third Tuesday', { exact: true })).toBeVisible();
  });

  // BYSETPOS / multiple weekdays per month increment: same "exercise a
  // real rrule shape end to end, assert the exact label" discipline as the
  // three MONTHLY recurrence tests just above — these are the two new
  // MONTHLY shapes this increment adds.
  test('creating a "several days of the month" habit shows the right label on its row', async ({ page }) => {
    const title = unique('E2E days-of-month habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'Monthly' }).click();
    await page.getByRole('button', { name: 'Several days' }).click();
    await page.getByRole('button', { name: 'Day 1 of the month', exact: true }).click();
    await page.getByRole('button', { name: 'Day 15 of the month', exact: true }).click();
    await page.getByRole('button', { name: 'Add habit' }).click();

    const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).last();
    await expect(row.getByText('Monthly on the 1st, 15th', { exact: true })).toBeVisible();
  });

  test('creating a "set of weekdays" habit shows the right label on its row', async ({ page }) => {
    const title = unique('E2E weekday-set habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'Monthly' }).click();
    await page.getByRole('button', { name: 'A set of weekdays' }).click();
    await page.getByLabel('Which occurrence among the selected weekdays').selectOption({ label: 'last' });
    await page.getByRole('button', { name: 'Mon', exact: true }).click();
    await page.getByRole('button', { name: 'Tue', exact: true }).click();
    await page.getByRole('button', { name: 'Wed', exact: true }).click();
    await page.getByRole('button', { name: 'Thu', exact: true }).click();
    await page.getByRole('button', { name: 'Fri', exact: true }).click();
    await page.getByRole('button', { name: 'Add habit' }).click();

    const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).last();
    await expect(row.getByText('Monthly, last Mon/Tue/Wed/Thu/Fri day', { exact: true })).toBeVisible();
  });

  // Fuller habit recurrence increment: same "exercise a real rrule shape
  // end to end, assert the exact label" discipline as the four recurrence
  // tests just above — "every N months" is the fifth shape-level addition
  // this increment makes (COUNT/UNTIL, tested separately below, are
  // orthogonal to the shape itself).
  test('creating an "every N months" habit shows the right label on its row', async ({ page }) => {
    const title = unique('E2E every-3-months habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'Monthly' }).click();
    // "A day of the month" (day 1, by DEFAULT_RECURRENCE) is already
    // selected once Monthly is picked — only the month interval needs
    // changing.
    await page.getByLabel('Repeat every N months').fill('3');
    await page.getByRole('button', { name: 'Add habit' }).click();

    const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).last();
    await expect(row.getByText('Every 3 months on the 1st', { exact: true })).toBeVisible();
  });

  // Fuller habit recurrence increment: COUNT and UNTIL are orthogonal to
  // every shape above (see HabitRecurrenceFields's own "Ends" section,
  // outside the frequency-specific blocks) — one test each, against the
  // simplest possible shape (plain daily), is enough to prove the wiring
  // without re-testing every shape × every end-condition combination (that
  // combinatorial space is already covered by rrule.spec.ts's real unit
  // tests, not duplicated here).
  test('a habit with a fixed occurrence count shows "N times total" on its row', async ({ page }) => {
    const title = unique('E2E count-limited habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'After N times' }).click();
    await page.getByLabel('Number of times before this habit stops recurring').fill('5');
    await page.getByRole('button', { name: 'Add habit' }).click();

    const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).last();
    await expect(row.getByText('Every day · 5 times total', { exact: true })).toBeVisible();
  });

  test('a habit with an end date shows "until <date>" on its row', async ({ page }) => {
    const title = unique('E2E end-dated habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'On a date' }).click();
    await page.getByLabel('Date this habit stops recurring after').fill('2030-01-01');
    await page.getByRole('button', { name: 'Add habit' }).click();

    const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).last();
    await expect(row.getByText('Every day · until 2030-01-01', { exact: true })).toBeVisible();
  });

  // Habit-edit UI increment: the first real coverage of updateHabit at
  // all — it existed on the backend before this increment with zero UI and
  // zero tests. Uses `.first()` for the row locator (not `.last()`, like
  // every recurrence-label test above) since editing needs the *outer* row
  // — the one that actually contains the Edit button — not the inner
  // text-only div those simpler read-only assertions target.
  test('editing a habit changes its recurrence, preferred time, protected duration, and goal link', async ({ page }) => {
    const goalTitle = unique('E2E habit-edit goal');
    const title = unique('E2E editable habit');

    await page.goto('/goals');
    await page.getByRole('button', { name: '+ New goal' }).click();
    await page.getByPlaceholder('Goal title…').fill(goalTitle);
    await page.getByRole('button', { name: 'Create goal' }).click();
    await expect(page.getByText(goalTitle, { exact: true })).toBeVisible();

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'Add habit' }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    // Resolved by visible text just this once, while the row is still in
    // view mode. From here on we target the row by its stable data-testid
    // instead of re-filtering by text: once Edit is clicked, the title
    // moves into an <input value="..."> — and an input's value is not part
    // of an element's text content, so a `hasText` filter that matched the
    // view-mode row stops matching the exact same row the instant it
    // switches to edit mode. Re-evaluating a `hasText`-based locator after
    // that point silently resolves to zero elements, which is what caused
    // every action after "Edit" to hang until timeout.
    const initialRow = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).first();
    const testId = await initialRow.getAttribute('data-testid');
    const row = page.locator(`[data-testid="${testId}"]`);

    await row.getByRole('button', { name: 'Edit', exact: true }).click();

    await row.getByRole('button', { name: 'Specific days' }).click();
    await row.getByRole('button', { name: 'Mon', exact: true }).click();
    await row.getByLabel('Preferred time').fill('08:00');
    await row.getByLabel('Protected duration in minutes').fill('30');
    await row.getByLabel('Link to goal').selectOption({ label: goalTitle });
    await row.getByRole('button', { name: 'Save', exact: true }).click();

    // Wait for the save to actually finish and the row to drop back into
    // view mode before reading its text — while the save is still in
    // flight the row is still showing the (disabled) recurrence editor,
    // where a non-exact "Mon" ambiguously matches both the "Monthly"
    // frequency button and the "Mon" weekday toggle button (a strict-mode
    // violation), neither of which is the plain-text recurrence label this
    // assertion actually wants.
    await expect(row.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();

    await expect(row.getByText('Mon', { exact: false })).toBeVisible();
    await expect(row.getByText('08:00', { exact: false })).toBeVisible();
    await expect(row.getByText(goalTitle, { exact: true })).toBeVisible();
  });

  test('editing a habit can be cancelled without saving changes', async ({ page }) => {
    const title = unique('E2E edit-cancel habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'Add habit' }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    // See the recurrence-edit test above for why this can't stay a
    // `hasText`-based locator once Edit is clicked: the title moves into an
    // <input value="...">, which doesn't count as text content, so a
    // `hasText` filter that matched the view-mode row silently stops
    // matching the same row in edit mode.
    const initialRow = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).first();
    const testId = await initialRow.getAttribute('data-testid');
    const row = page.locator(`[data-testid="${testId}"]`);

    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await row.getByLabel('Habit title').fill('This should never be saved');
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Back to the plain display row, original title intact.
    await expect(row.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText('This should never be saved')).toHaveCount(0);
  });

  // Habit-edit UI increment: the "deactivating is a one-way trap" gap —
  // there was previously no way back at all once a habit was deactivated.
  test('deactivating and reactivating a habit updates its row and its strikethrough state', async ({ page }) => {
    const title = unique('E2E reactivate habit');

    await page.goto('/habits');
    await page.getByPlaceholder('New habit…').fill(title);
    await page.getByRole('button', { name: 'Add habit' }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: title }).first();
    await row.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Reactivate', exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Reactivate', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Deactivate', exact: true })).toBeVisible();
  });
});
