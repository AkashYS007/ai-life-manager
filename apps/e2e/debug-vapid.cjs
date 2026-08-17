// TEMPORARY standalone diagnostic — not part of the test suite. Isolates
// exactly how this machine's installed Chromium + Playwright combination
// handles the notifications permission, outside the full test-runner
// harness, so we get direct answers instead of another guess-and-rerun
// cycle. Run with: node debug-vapid.cjs (from apps/e2e).
const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function run(label, setup) {
  const browser = await chromium.launch();
  try {
    const result = await setup(browser);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(`\n=== ${label} (THREW) ===`);
    console.log(err && err.stack ? err.stack : err);
  } finally {
    await browser.close();
  }
}

(async () => {
  console.log('Playwright chromium version:', chromium.name ? chromium.name() : 'n/a');

  await run('A: permissions set at newContext() time, no navigation before check', async (browser) => {
    const context = await browser.newContext({ permissions: ['notifications'] });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/notifications');
    const beforeRequest = await page.evaluate(() => Notification.permission);
    const requested = await page.evaluate(() => Notification.requestPermission());
    const afterRequest = await page.evaluate(() => Notification.permission);
    return { beforeRequest, requested, afterRequest };
  });

  await run('B: grantPermissions() after context creation, before navigation', async (browser) => {
    const context = await browser.newContext();
    await context.grantPermissions(['notifications']);
    const page = await context.newPage();
    await page.goto('http://localhost:3000/notifications');
    const beforeRequest = await page.evaluate(() => Notification.permission);
    const requested = await page.evaluate(() => Notification.requestPermission());
    const afterRequest = await page.evaluate(() => Notification.permission);
    return { beforeRequest, requested, afterRequest };
  });

  await run('C: grantPermissions() with explicit origin', async (browser) => {
    const context = await browser.newContext();
    await context.grantPermissions(['notifications'], { origin: 'http://localhost:3000' });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/notifications');
    const beforeRequest = await page.evaluate(() => Notification.permission);
    const requested = await page.evaluate(() => Notification.requestPermission());
    const afterRequest = await page.evaluate(() => Notification.permission);
    return { beforeRequest, requested, afterRequest };
  });

  await run('D: same as test file — navigate, THEN grantPermissions (mirrors current beforeEach/test order)', async (browser) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://localhost:3000/notifications');
    await context.grantPermissions(['notifications']);
    const beforeRequest = await page.evaluate(() => Notification.permission);
    const requested = await page.evaluate(() => Notification.requestPermission());
    await page.reload();
    const afterReload = await page.evaluate(() => Notification.permission);
    return { beforeRequest, requested, afterReload };
  });

  // E: headed mode — headless Chromium is documented to not actually
  // support displaying notifications, so it may simply hardcode the
  // synchronous Notification.permission property to 'denied' regardless of
  // the real (correctly-granted, per A-D's "requested":"granted") permission
  // state. A real headed browser has no such limitation. This run() call
  // needs its own browser (not the shared launch() default), so it's
  // inlined here rather than going through the run() helper's browser.
  console.log('\n=== E: headed mode ===');
  try {
    const browser = await chromium.launch({ headless: false });
    try {
      const context = await browser.newContext();
      await context.grantPermissions(['notifications']);
      const page = await context.newPage();
      await page.goto('http://localhost:3000/notifications');
      const beforeRequest = await page.evaluate(() => Notification.permission);
      const requested = await page.evaluate(() => Notification.requestPermission());
      const afterRequest = await page.evaluate(() => Notification.permission);
      console.log(JSON.stringify({ beforeRequest, requested, afterRequest }, null, 2));
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.log('(THREW)', err && err.stack ? err.stack : err);
  }

  // F: launchPersistentContext + headed + grantPermissions, mirroring the
  // real spec's fixture exactly — including the actual pushManager.subscribe
  // call with the real VAPID key, all the way through, so this either fully
  // confirms the fixture works or tells us precisely which step doesn't.
  console.log('\n=== F: launchPersistentContext (mirrors real spec fixture), full flow ===');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ailm-debug-persistent-'));
  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      baseURL: 'http://localhost:3000',
    });
    try {
      await context.grantPermissions(['notifications']);
      const page = context.pages()[0] || (await context.newPage());
      page.on('console', (msg) => console.log(`  [BROWSER ${msg.type()}]`, msg.text()));
      page.on('pageerror', (err) => console.log('  [BROWSER pageerror]', err.message));
      await page.goto('http://localhost:3000/notifications');
      const beforeRequest = await page.evaluate(() => Notification.permission);
      const requested = await page.evaluate(() => Notification.requestPermission());
      const afterRequest = await page.evaluate(() => Notification.permission);

      const res = await fetch('http://localhost:4000/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-user-email': 'akash@example.com' },
        body: JSON.stringify({ query: '{ vapidPublicKey }' }),
      });
      const { data } = await res.json();
      const vapidPublicKey = data.vapidPublicKey;

      const subscribeResult = await page.evaluate(async (key) => {
        function urlBase64ToUint8Array(base64Url) {
          const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
          const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
          const rawData = window.atob(base64);
          return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
          });
          return { ok: true, endpoint: subscription.endpoint };
        } catch (err) {
          return { ok: false, error: err && err.message, name: err && err.name };
        }
      }, vapidPublicKey);

      console.log(JSON.stringify({ beforeRequest, requested, afterRequest, subscribeResult }, null, 2));
    } finally {
      await context.close();
    }
  } catch (err) {
    console.log('(THREW)', err && err.stack ? err.stack : err);
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})();
