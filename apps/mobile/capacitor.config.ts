import type { CapacitorConfig } from '@capacitor/cli';

// Remote-URL ("hosted") mode, deliberately, not a bundled static build. This
// app is server-rendered (Next.js SSR, Clerk auth, live GraphQL data) — a
// bundled/offline copy of the UI would either need its own separate build
// pipeline duplicating apps/web, or would drift from production the moment
// either one changed without the other. Pointing the native WebView straight
// at the real, already-deployed site means every feature ships to the app
// the instant it ships to the web, with zero extra release process. The
// trade this makes on purpose: the app needs network access to load (same
// as any other client of this API), and it can't function as a fully
// offline-first app the way a bundled build could — apps/web/public/sw.js's
// own runtime cache (see that file's own extensive comments) is what
// already covers the "works with a flaky connection" case for the shell
// itself, and that keeps working unchanged inside this WebView.
const config: CapacitorConfig = {
  appId: 'com.genzylife.ailifemanager',
  appName: 'AI Life Manager',
  // Required by the Capacitor config schema even in remote-URL mode (it's
  // where `cap sync` would copy a bundled build from) — never actually read
  // at runtime here since `server.url` below takes over navigation.
  webDir: 'www',
  server: {
    url: 'https://www.genzylife.com',
    // Real HTTPS production origin — cleartext (plain HTTP) traffic is never
    // needed or allowed.
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    // The WebView's own back button should behave like a browser back
    // button, not close the whole app on the first press — the same
    // behavior people already expect from every other app with in-app
    // navigation history.
    allowMixedContent: false,
  },
};

export default config;
