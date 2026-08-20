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
          // Bug fix (2026-08-20): without this, the app was completely unusable —
          // it would boot straight out to the system browser (Chrome) on nearly
          // every real launch, even before a user tapped anything. Root cause:
          // Clerk (this app's auth provider) loads a hidden same-origin-looking
          // iframe from its own Frontend API host (currently
          // notable-skylark-91.clerk.accounts.dev — this is the *public*
          // frontend-api host baked into NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, not a
          // secret, safe to hardcode here) immediately on page load, to sync
          // session state. Capacitor's Bridge.shouldOverrideUrlLoading (see
          // node_modules/@capacitor/android/.../BridgeWebViewClient.java) does
          // NOT check WebResourceRequest#isForMainFrame() before deciding whether
          // a navigation is "external" — so that invisible iframe's cross-origin
          // navigation got treated exactly like a user tapping a link to leave
          // the app, and Capacitor fired an Intent.ACTION_VIEW that handed the
          // *entire* WebView experience to Chrome. Explains every symptom seen
          // while debugging this: worked correctly with the network off (Clerk's
          // script never got the chance to run), broke the instant the network
          // came back (Clerk loaded and immediately triggered the handoff), and
          // the app's own source/manifest/APK all checked out clean because the
          // bug was in how the *library* handles sub-frame navigation, not in any
          // code this repo owns. Listing the host here keeps Clerk's session-sync
          // iframe navigation inside the app's WebView instead of kicking it out.
          // If Clerk's frontend-api host ever changes (e.g. a Clerk project
          // reset, or moving to a custom Clerk domain), this needs updating to
          // match — the current value can always be reconfirmed by checking
          // `window.Clerk.frontendApi` on the live site.
          allowNavigation: ['notable-skylark-91.clerk.accounts.dev'],
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
