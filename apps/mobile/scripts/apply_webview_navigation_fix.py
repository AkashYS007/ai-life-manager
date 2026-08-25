#!/usr/bin/env python3
"""Overrides the freshly-scaffolded Android project's MainActivity to (1) fix
a real, confirmed bug in how Capacitor decides a navigation is "external" to
the app, and (2) make a tapped push notification's deep link actually
navigate the app instead of silently doing nothing. Run *after* `npx cap add
android` (which creates MainActivity.java in the first place) and *before*
`npx cap sync android`, same ordering as apply_icons.py and
apply_firebase_config.py, for the same reason: android/ is regenerated from
scratch on every CI run, so this has to be re-applied here rather than
committed as edited native source.

Bug 1 (found + confirmed 2026-08-20): Capacitor's own
BridgeWebViewClient.shouldOverrideUrlLoading (see
node_modules/@capacitor/android/.../BridgeWebViewClient.java) calls
Bridge.launchIntent() for EVERY navigation-type WebResourceRequest it sees,
without ever checking WebResourceRequest#isForMainFrame() first. That means
a cross-origin navigation from an invisible background/iframe request --
not just a real, user-visible top-level navigation -- gets treated exactly
like a user tapping a link to leave the app, and Capacitor fires an
Intent.ACTION_VIEW that hands the *entire* WebView experience to the system
browser (Chrome). This app's auth provider (Clerk) is exactly the kind of
library that can trigger this from a background request during normal
sign-in/session-sync activity, and it broke the app on essentially every
real launch. Adding the specific host to capacitor.config.ts's
server.allowNavigation (see that file's own comment) helps for hosts known
ahead of time, but isn't a complete fix -- it only covers navigation-type
requests to that exact host, and doesn't protect against every mechanism a
third-party auth SDK might use. This is the robust, complete fix: skip
Capacitor's external-launch decision entirely for any request that isn't
for the main frame. A real top-level navigation to a different host (e.g.
the user actually tapping an external link) still goes through Capacitor's
normal handling and correctly opens in the system browser -- only
background/sub-frame requests are exempted, which is what should have been
happening all along.

Bug 2 (found 2026-08-24, mobile app review follow-up): AiLifeManagerMessagingService.
showBanner() (see apply_native_notifications.py) attaches a `deeplink` extra
(e.g. "/routines") to the PendingIntent it builds for a tapped push
notification -- but until this fix, nothing on the Android side ever read
that extra back out. Tapping a push notification just opened MainActivity
(or brought it to the foreground) wherever its WebView already was, silently
dropping the one piece of information the notification was actually about --
compare apps/web/public/sw.js's own notificationclick handler, which already
does this correctly for the browser/PWA path. handleDeeplinkIntent() below is
the fix, called from both entry points a tapped notification can take: a
cold/fresh launch goes through onCreate; if MainActivity is already running
in the task stack (likely, since the PendingIntent sets
FLAG_ACTIVITY_CLEAR_TOP), Android reuses that instance and delivers the new
Intent to onNewIntent instead, which never calls onCreate at all.
"""
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MOBILE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..'))
MAIN_ACTIVITY = os.path.join(
    MOBILE_DIR, 'android', 'app', 'src', 'main', 'java',
    'com', 'genzylife', 'ailifemanager', 'MainActivity.java'
)

CONTENT = """package com.genzylife.ailifemanager;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    // Bug fix (2026-08-20) -- see apply_webview_navigation_fix.py's own
    // module comment for the full story. Capacitor's default
    // BridgeWebViewClient hands ANY cross-origin navigation, including one
    // from an invisible background/iframe request (not just a real,
    // user-visible top-level navigation), out to the system browser. That
    // silently broke this app on nearly every real launch, because Clerk
    // (this app's auth provider) makes exactly this kind of background
    // request during normal sign-in/session-sync activity. Replacing the
    // WebViewClient here with one that only ever hands off *main-frame*
    // navigation is the complete, correct fix -- a real top-level
    // navigation to a different host (e.g. the user actually tapping an
    // external link) still opens in the system browser as expected; only
    // background/sub-frame requests are kept inside the app's own WebView,
    // which is what should have been happening all along.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (!request.isForMainFrame()) {
                        return false;
                    }
                    return super.shouldOverrideUrlLoading(view, request);
                }
            }
        );
        handleDeeplinkIntent(getIntent());
    }

    // Notification deep-link fix (2026-08-24) -- see apply_webview_navigation_fix.py's
    // own module comment (Bug 2) for the full story. A tapped push
    // notification can deliver its Intent through either entry point
    // depending on whether MainActivity is already alive in the task stack,
    // so both are wired to the same handler.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleDeeplinkIntent(intent);
    }

    private void handleDeeplinkIntent(Intent intent) {
        if (intent == null) return;
        String deeplink = intent.getStringExtra("deeplink");
        if (deeplink == null || deeplink.isEmpty()) return;
        // deeplink only ever originates from this app's own backend
        // (NativePushService.sendToUser's payload, itself only ever built
        // from a handful of hardcoded literal paths in this repo's own
        // scheduler/planner/recommendations/focus services and
        // NotificationsService -- never from user input), so this can never
        // actually see anything else in practice. Validated anyway, the same
        // "defend the boundary even when the value is already trusted"
        // discipline AuthGuard and every DTO validator in this codebase
        // already follow -- a same-origin relative path only, so a
        // malformed or unexpected value can never make the WebView load an
        // arbitrary external origin.
        if (!deeplink.startsWith("/") || deeplink.startsWith("//")) return;
        bridge.getWebView().loadUrl("https://www.genzylife.com" + deeplink);
    }
}
"""

def main():
    if not os.path.isfile(MAIN_ACTIVITY):
        raise SystemExit(
            f'MainActivity.java not found at {MAIN_ACTIVITY} — run `npx cap add android` first'
        )
    with open(MAIN_ACTIVITY, 'w') as f:
        f.write(CONTENT)
    print(f'wrote fixed MainActivity.java to {MAIN_ACTIVITY}')

if __name__ == '__main__':
    main()
