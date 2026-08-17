import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Exercises the one piece of the Real notification delivery increment that
// a real browser can actually complete end to end without a live push
// service intercepting anything: granting permission and successfully
// subscribing via the real Chromium PushManager, which requires reaching
// the browser's own internal push service over the network — precisely
// the kind of outbound request the build sandbox's network allowlist
// blocks (see this suite's own README section), so this spec, more than
// any other in this file, needs a real, unrestricted network to pass.
//
// Three real, confirmed-not-guessed environment constraints this file
// works around, none of them an app bug (all root-caused live, 2026-08-15,
// by capturing what the app's own errors actually said and by reading the
// actual Playwright trace — see this file's git history for the full
// investigation):
//
// 1. Headed, not headless (unlike every other spec in this suite). Headless
//    Chromium hardcodes the synchronous `Notification.permission` property
//    to `'denied'` regardless of the real, correctly-granted permission
//    state (`context.grantPermissions` genuinely works either way —
//    `Notification.requestPermission()` reliably resolves `'granted'` in
//    both modes — headless just never reports it back on that property).
//    Confirmed with a standalone repro script outside the test harness,
//    across four different grant orderings, all identically stuck; headed
//    mode needed no workaround at all.
//
// 2. A real, on-disk Chrome profile via `launchPersistentContext`, not the
//    standard ephemeral `context`/`page` fixture every other spec uses.
//    Every Playwright-created ephemeral context is implemented as an
//    off-the-record Chrome profile under the hood — functionally
//    incognito — and Chrome deliberately, permanently blocks the real Push
//    API there ("Chrome currently does not support the Push API in
//    incognito mode... deliberately no way to feature-detect this", see
//    https://crbug.com/41124656), a policy decision with no app-level or
//    test-assertion-level workaround. A temp profile dir is created fresh
//    per run and torn down after, so this doesn't accumulate on-disk state
//    between runs.
//
// 3. `serviceWorkers: 'allow'` set explicitly. `launchPersistentContext`
//    does not inherit the same service-worker default the standard
//    fixtures' regular `browser.newContext()` gets — without this,
//    `navigator.serviceWorker.ready` (which PushSubscribeButton's own
//    `enable()` awaits before subscribing) never resolves at all, silently
//    hanging the whole flow with no error and no timeout of its own.
//
// A currently-open, unresolved flake, being tracked rather than guess-fixed
// further (2026-08-16): `registration.pushManager.subscribe()` — the one
// call in the whole flow that reaches Google's real, external push
// registration service — has intermittently hung forever (no resolve, no
// reject, no error) across several recent runs. Confirmed NOT caused by:
// the VAPID key value (queried live, correct), `serviceWorkers: 'allow'`
// (present, and `serviceWorker.ready` itself resolves fine, fast, every
// time), and NOT specific to Playwright's bundled test Chromium — the
// identical hang was reproduced on real, unmanaged, officially-signed
// Google Chrome too (`channel: 'chrome'`, since reverted — it made no
// difference, so there's no reason to require a real Chrome install for
// this spec). Basic TCP reachability to Google's push infra is fine
// (`Test-NetConnection fcm.googleapis.com -Port 443` succeeds). That
// leaves this as either a transient condition on Google's side or
// something specific to this machine's network path that a plain TCP
// check to the wrong hostname wouldn't catch (the browser's actual
// push-registration traffic isn't the same host/protocol a page-level
// `fetch` would use, and never appears in a Playwright network trace
// either way). If this reappears after a real cooldown period, that rules
// out simple rate-limiting and this needs a fresh look, not another guess.
const test = base.extend<{ context: BrowserContext; page: Page }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ailm-push-test-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      baseURL: 'http://localhost:3000',
      serviceWorkers: 'allow',
    });
    await context.grantPermissions(['notifications']);
    try {
      await use(context);
    } finally {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

test.describe('Push notification subscribe flow', () => {
  test('turning on browser notifications registers a real subscription, and turning it off unregisters it', async ({
    page,
  }) => {
    // TEMPORARY diagnostic — remove once the "consistently failing again
    // after being confirmed passing" regression is root-caused.
    page.on('console', (msg) => console.log(`[BROWSER ${msg.type()}]`, msg.text()));
    page.on('pageerror', (err) => console.log('[BROWSER pageerror]', err.message));

    await page.goto('/notifications');

    // A brand-new temp Chrome profile (see the fixture above) registers its
    // service worker from scratch on this very first visit — real users hit
    // this same install→activate window too, but a person's first click
    // naturally comes seconds later; an automated click right after
    // page-load can race ahead of it. PushSubscribeButton's own `enable()`
    // already awaits `navigator.serviceWorker.ready` before subscribing, so
    // this doesn't change what the app does — it just removes activation
    // timing as a source of test flakiness by waiting for the same
    // precondition explicitly, before the click, rather than leaving it to
    // resolve mid-click on however this run happens to be timed.
    await page.evaluate(() => navigator.serviceWorker.ready);

    const toggle = page.getByRole('button', { name: /Turn on browser notifications/ });
    // If the backend has no VAPID keys configured, PushSubscribeButton
    // renders nothing at all rather than an error (see its own comment) —
    // fail loudly here rather than silently passing on a misconfigured
    // environment, since VAPID_PUBLIC_KEY/PRIVATE_KEY are meant to already
    // be filled in the repo-root .env for local dev (see config.module.ts's
    // own comment on why that's the one file that actually gets read).
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();

    await expect(page.getByRole('button', { name: /Turn off browser notifications/ })).toBeVisible({
      timeout: 15_000,
    });

    // A real subscription should now exist in the browser itself.
    const hasSubscription = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription !== null;
    });
    expect(hasSubscription).toBe(true);

    await page.getByRole('button', { name: /Turn off browser notifications/ }).click();
    await expect(page.getByRole('button', { name: /Turn on browser notifications/ })).toBeVisible({
      timeout: 15_000,
    });
  });
});
