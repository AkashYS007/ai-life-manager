import { test, expect } from '@playwright/test';

// Diagnostic quiz free-text answers increment: the quiz's first genuinely
// open-ended question — every question before it is a fixed preset pick
// from a card. The e2e global-setup already completes onboarding for the
// fixed dev account before any spec runs (see global-setup.ts's own
// comment on why) — /onboarding itself doesn't redirect away once
// completed. Resumable onboarding wizard increment: plain `/onboarding`
// (no params) now resumes wherever the wizard was last left off instead of
// always showing the quiz, so — same as Settings' own "Redo the onboarding
// quiz →" link — `?redo=quiz` is what reliably lands here on the quiz step
// with existing answers pre-filled (the Re-enter onboarding increment),
// which is exactly the state this test needs: a real load of the real quiz
// UI, not a fresh account's first-ever walkthrough, and not wherever a
// previous spec happened to leave the shared dev account's wizard
// progress.
test.describe('Onboarding — diagnostic quiz free-text answer', () => {
  test('typing a free-text answer and continuing accepts real text and advances past the quiz', async ({ page }) => {
    await page.goto('/onboarding?redo=quiz');

    const freeText = page.getByLabel('Anything else the AI should know about you right now?', { exact: false });
    await expect(freeText).toBeVisible();
    await freeText.fill('Training for a marathon in October.');
    await expect(freeText).toHaveValue('Training for a marathon in October.');

    await page.getByRole('button', { name: 'Continue' }).click();

    // Moved off the quiz step onto the calendar-connect step — no inline
    // error, real progression, not just "the button didn't crash."
    await expect(page.getByText('Connect your calendar')).toBeVisible();
  });
});

// Free time picker for quiz's work/quiet hours increment: the quiz's
// work-hours and quiet-hours questions used to be preset ChoiceCard grids
// (e.g. "6:00am–10:00am") — a real time like 6:30am was never selectable.
// This confirms the real `<input type="time">` pairs (same pattern as
// Settings' Work hours / Notifications' Quiet hours) render, accept a
// non-preset value, and the quiz still advances on Continue.
test.describe('Onboarding — free time picker for work/quiet hours', () => {
  test('entering non-preset work and quiet hour times and continuing advances past the quiz', async ({ page }) => {
    // Resumable onboarding wizard increment: `?redo=quiz`, same reasoning
    // as the free-text spec's own comment above — plain `/onboarding` no
    // longer reliably lands on the quiz step.
    await page.goto('/onboarding?redo=quiz');

    const workStart = page.getByLabel('From', { exact: true });
    const workEnd = page.getByLabel('to', { exact: true }).first();
    const quietStart = page.getByLabel('Quiet hours from', { exact: true });
    const quietEnd = page.getByLabel('to', { exact: true }).last();

    await expect(workStart).toBeVisible();
    await workStart.fill('06:30');
    await workEnd.fill('16:45');
    await quietStart.fill('21:15');
    await quietEnd.fill('05:50');

    await expect(workStart).toHaveValue('06:30');
    await expect(workEnd).toHaveValue('16:45');
    await expect(quietStart).toHaveValue('21:15');
    await expect(quietEnd).toHaveValue('05:50');

    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('Connect your calendar')).toBeVisible();
  });
});

// Fix onboarding calendar-connect redirect increment: before this fix,
// landing back on `/onboarding?googleConnect=success` after connecting a
// calendar from inside the wizard fell through to the "already completed
// onboarding → jump to the quiz step" prefill default (onboardingCompletedAt
// is stamped the moment the quiz step submits, well before the calendar
// step is ever reached) — so the wizard silently dropped a person back on
// the quiz instead of resuming where they actually left off. A real
// Google/Microsoft OAuth round trip can't run in this suite (no real
// credentials — see the README's own standing OAuth limitation note), but
// the bug and the fix both live entirely in how `?googleConnect=...`/
// `?microsoftConnect=...` are read on load, which a direct navigation
// exercises identically to a real redirect landing on the same URL.
test.describe('Onboarding — resuming the calendar step after an OAuth redirect', () => {
  test('landing on /onboarding?googleConnect=success goes straight to the calendar step, not back to the quiz', async ({ page }) => {
    await page.goto('/onboarding?googleConnect=success');

    await expect(page.getByText('Connect your calendar')).toBeVisible();
    // The quiz step's own distinctive heading must NOT be what's showing —
    // this is the exact regression the fix closes.
    await expect(page.getByText('A quick baseline')).not.toBeVisible();
  });

  test('landing on /onboarding?microsoftConnect=error still goes to the calendar step and shows the inline error', async ({ page }) => {
    await page.goto('/onboarding?microsoftConnect=error');

    await expect(page.getByText('Connect your calendar')).toBeVisible();
    await expect(page.getByText(/Couldn.t connect Microsoft Calendar/)).toBeVisible();
  });
});

// Resumable onboarding wizard increment. Neither test below uses `?redo=quiz`
// or `?googleConnect=...` — the whole point is proving plain `/onboarding`
// (a real reload, the same thing closing the tab and reopening the app
// produces) now resumes from real, server-tracked progress
// (User.onboardingWizardStep) instead of either always jumping to the quiz
// (the pre-this-increment default) or losing all memory of the wizard ever
// having been started (client-only React state, wiped by any reload).
test.describe('Onboarding — resuming the wizard across a reload', () => {
  test('reopening /onboarding after reaching the calendar step resumes there, not back at the quiz', async ({ page }) => {
    await page.goto('/onboarding?redo=quiz');
    await expect(page.getByText('A quick baseline')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Connect your calendar')).toBeVisible();

    // A plain reload, no query params — this is the part that used to
    // regress back to the quiz step before this increment.
    await page.goto('/onboarding');
    await expect(page.getByText('Connect your calendar')).toBeVisible();
    await expect(page.getByText('A quick baseline')).not.toBeVisible();
  });

  test('reopening /onboarding after reaching the First plan step resumes there', async ({ page }) => {
    await page.goto('/onboarding?redo=quiz');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Connect your calendar')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Your first plan')).toBeVisible();

    await page.goto('/onboarding');
    await expect(page.getByText('Your first plan')).toBeVisible();
  });
});

// Free-text "biggest source of overload" increment: the quiz's last
// remaining fixed-preset question — used to be five ChoiceCard buttons
// ("Work & career", "Health & fitness", ...), now a real text input. This
// confirms a genuinely non-preset phrase can be typed and the quiz still
// advances normally.
test.describe('Onboarding — free-text biggest source of overload', () => {
  test('typing a non-preset phrase and continuing advances past the quiz', async ({ page }) => {
    await page.goto('/onboarding?redo=quiz');

    const overload = page.getByLabel("What's your biggest source of overload right now?", { exact: false });
    await expect(overload).toBeVisible();
    await overload.fill('Trying to keep up with three side projects and a new puppy');
    await expect(overload).toHaveValue('Trying to keep up with three side projects and a new puppy');

    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('Connect your calendar')).toBeVisible();
  });
});
