#!/usr/bin/env python3
"""Wires Firebase Cloud Messaging into the freshly-scaffolded Android
project. Run *after* `npx cap add android` (which is what creates the
android/ directory in the first place) and *before* `npx cap sync android`,
same ordering as apply_icons.py and for the same reason: android/ is
regenerated from scratch on every CI run (see apps/mobile/README.md), so
anything Firebase-specific has to be re-applied here rather than committed
as edited native source.

google-services.json itself (apps/mobile/google-services.json, committed —
see that file's own note on why this is safe to commit) is *client*
configuration: a project number, app ID, and an API key that ends up
compiled straight into the shipped APK regardless, the same way any
Android app's Firebase config does. It is not a secret and needs no Actions
secret/env var — only the *server-side* Admin SDK credential
(FIREBASE_SERVICE_ACCOUNT_BASE64, set directly on the backend host) is
actually sensitive.

Two edits, both idempotent (safe to run against a build.gradle that already
has them, so a second run — or a future Capacitor version that starts
shipping this by default — never double-applies):

1. Copy google-services.json into android/app/, where the Google Services
   Gradle plugin expects to find it.
2. Ensure the root build.gradle's buildscript classpath includes
   com.google.gms:google-services, and the app-level build.gradle actually
   applies that plugin. Capacitor's own template has shipped an optional
   "apply the plugin if google-services.json exists" block in
   android/app/build.gradle for years specifically so Firebase-based
   plugins like push-notifications can hook in this way — this script
   still checks explicitly rather than assuming that block is present,
   since relying on undocumented upstream template behavior without a
   fallback is exactly the kind of thing that quietly breaks on a
   Capacitor version bump.
"""
import os
import re
import shutil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MOBILE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..'))
ANDROID_DIR = os.path.join(MOBILE_DIR, 'android')

SOURCE_CONFIG = os.path.join(MOBILE_DIR, 'google-services.json')
DEST_CONFIG = os.path.join(ANDROID_DIR, 'app', 'google-services.json')

ROOT_GRADLE = os.path.join(ANDROID_DIR, 'build.gradle')
APP_GRADLE = os.path.join(ANDROID_DIR, 'app', 'build.gradle')

GMS_CLASSPATH = "classpath 'com.google.gms:google-services:4.4.2'"
GMS_APPLY = "apply plugin: 'com.google.gms.google-services'"


def main():
    if not os.path.isfile(SOURCE_CONFIG):
        raise SystemExit(f'google-services.json not found at {SOURCE_CONFIG}')
    if not os.path.isdir(ANDROID_DIR):
        raise SystemExit(f'android/ directory not found at {ANDROID_DIR} — run `npx cap add android` first')

    shutil.copyfile(SOURCE_CONFIG, DEST_CONFIG)
    print(f'copied {SOURCE_CONFIG} -> {DEST_CONFIG}')

    # Root build.gradle: add the classpath to the buildscript dependencies
    # block if it isn't already there.
    with open(ROOT_GRADLE, 'r') as f:
        root_contents = f.read()

    if 'com.google.gms:google-services' in root_contents:
        print('root build.gradle already has the google-services classpath — skipping')
    else:
        match = re.search(r'(dependencies\s*\{)', root_contents)
        if not match:
            raise SystemExit('could not find a buildscript "dependencies {" block in android/build.gradle')
        insert_at = match.end()
        root_contents = root_contents[:insert_at] + f'\n        {GMS_CLASSPATH}' + root_contents[insert_at:]
        with open(ROOT_GRADLE, 'w') as f:
            f.write(root_contents)
        print('added google-services classpath to root build.gradle')

    # App-level build.gradle: apply the plugin if it isn't already applied.
    with open(APP_GRADLE, 'r') as f:
        app_contents = f.read()

    if 'com.google.gms.google-services' in app_contents:
        print('app/build.gradle already applies the google-services plugin — skipping')
    else:
        app_contents = app_contents.rstrip() + f'\n\n{GMS_APPLY}\n'
        with open(APP_GRADLE, 'w') as f:
            f.write(app_contents)
        print('appended google-services plugin application to app/build.gradle')


if __name__ == '__main__':
    main()
