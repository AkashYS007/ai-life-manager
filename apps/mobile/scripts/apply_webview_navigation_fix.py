#!/usr/bin/env python3
"""Overrides the freshly-scaffolded Android project's WebViewClient to fix a
real, confirmed bug in how Capacitor decides a navigation is "external" to
the app. Run *after* `npx cap add android` (which creates MainActivity.java
in the first place) and *before* `npx cap sync android`, same ordering as
apply_icons.py and apply_firebase_config.py, for the same reason: android/
is regenerated from scratch on every CI run, so this has to be re-applied
here rather than committed as edited native source.

Bug (found + confirmed 2026-08-20): Capacitor's own
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
"""
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MOBILE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..'))
MAIN_ACTIVITY = os.path.join(
    MOBILE_DIR, 'android', 'app', 'src', 'main', 'java',
    'com', 'genzylife', 'ailifemanager', 'MainActivity.java'
)

CONTENT = """package com.genzylife.ailifemanager;

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
