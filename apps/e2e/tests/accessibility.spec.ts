import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility (WCAG AA) pass increment. This is a real, repeatable
// regression check — not the one-time manual pass every "fix it once and
// hope it stays fixed" approach risks — so a future change that
// accidentally drops a form label or a contrast-passing color doesn't ship
// unnoticed. axe-core (the same open-source engine Chrome DevTools' own
// Lighthouse/Accessibility panel and most real-world automated a11y CI
// pipelines are built on) scans the live, fully-rendered DOM, not source
// code — it catches things static analysis structurally can't (an
// aria-label pointing at the wrong element, a color that only fails
// contrast once its actual computed CSS is known).
//
// Scoped to `wcag2a`/`wcag2aa`/`wcag21aa` rule tags specifically — the
// exact standard this increment targets, per its own name — rather than
// axe's full "best-practice" rule set, which includes stricter
// recommendations beyond what WCAG AA itself requires and would make this
// suite flag things this increment never claimed to fix.
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

// One page per major, already-reachable screen a signed-in dev-auth account
// can reach without further setup (no Google/Microsoft/Apple calendar
// connection, no existing habit/goal/focus-session data required) — the
// same "test what's actually reachable without extra fixtures" pragmatism
// the rest of this suite already follows. Excludes /sign-in and /sign-up
// (Clerk-hosted UI this project doesn't own or control the markup of) and
// /onboarding (global-setup.ts already completes it for this account, so
// it would just redirect to /today anyway).
const PAGES_TO_CHECK = [
  '/today',
  '/tasks',
  '/journal',
  '/calendar',
  '/habits',
  '/goals',
  '/routines',
  '/focus',
  '/chat',
  '/memory',
  '/notifications',
  '/analytics',
  '/more',
];

test.describe('Accessibility (WCAG AA) — axe-core scan', () => {
  for (const path of PAGES_TO_CHECK) {
    test(`${path} has no critical or serious WCAG AA violations`, async ({ page }) => {
      await page.goto(path);
      // Every page shows its own loading state briefly before real data
      // arrives (see each page's own `if (loading)` branch) — waiting for
      // the network to go idle means axe scans the real, data-populated
      // DOM, not a transient "Loading…" placeholder.
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();

      // Filtered to critical/serious specifically — matches the same
      // pragmatic scoping judgment call this increment's README section
      // makes explicit: a real, thorough pass, not a claim of pixel-perfect
      // universal compliance. A "moderate" or "minor" axe finding is worth
      // knowing about (see the full violation dump on failure below) but
      // not, on its own, a reason to fail this suite and block a build.
      const seriousOrCritical = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );

      if (seriousOrCritical.length > 0) {
        const details = seriousOrCritical
          .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} element(s)) — ${v.helpUrl}`)
          .join('\n');
        // eslint-disable-next-line no-console
        console.log(`axe violations on ${path}:\n${details}`);
      }

      expect(seriousOrCritical, `${path} has ${seriousOrCritical.length} critical/serious axe violation(s)`).toEqual(
        [],
      );
    });
  }
});
