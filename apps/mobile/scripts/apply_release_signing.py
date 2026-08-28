#!/usr/bin/env python3
"""Wires real release signing into the freshly-scaffolded Android project.
Run *after* `npx cap add android` and *before* `npx cap sync android`, same
ordering as apply_icons.py / apply_firebase_config.py / apply_webview_
navigation_fix.py / apply_native_notifications.py, and for the same
reason: android/ is regenerated from scratch on every CI run (see
apps/mobile/README.md), so anything signing-related has to be re-applied
here rather than committed as edited native source â and a real signing
keystore must never be committed to the repo at all regardless.

Deployment-maturity pass (2026-08-28): before this script, every Android
build in CI produced only an unsigned debug APK (`assembleDebug`) â
installable for testing, but not what the Play Store accepts for a real
listing. Google requires every release upload to be signed with the same
private key for the life of the app, so unlike this repo's other optional
integrations (Stripe, Twilio, Sentry, ...) this one is a one-way door: the
keystore generated alongside this script is the *only* one that can ever
sign updates to whatever package name has already been published under it.
Losing it, or its passwords, after a real Play Store submission means the
app can never be updated again under that listing â only shipped as a new
one. That is also exactly why this script never generates a keystore
itself: it has to already exist somewhere durable (a password manager, a
locked-down secrets vault) before this script has anything to read.

Optional and fully backward-compatible, same pattern as every other
optional integration in this codebase (see apps/backend/src/config/
env.validation.ts's own SENTRY_DSN comment): if ANDROID_KEYSTORE_BASE64
isn't set, this script no-ops and android/app/build.gradle is left exactly
as Capacitor's own template produces it â the existing unsigned
`assembleDebug` build in android-build.yml keeps working unchanged for
every fork/contributor who hasn't set up signing secrets. Four env vars,
required together (same "all N or none" convention as this repo's other
multi-var optional integrations, e.g. the Google Calendar block in
.env.example):

  ANDROID_KEYSTORE_BASE64   base64 of the .keystore/.jks file itself
                             (`base64 -i release.keystore`, one line)
  ANDROID_KEYSTORE_PASSWORD the keystore's own store password
  ANDROID_KEY_ALIAS         the alias of the key inside that keystore
  ANDROID_KEY_PASSWORD      that key's own password (often == store
                             password, but keytool allows them to differ)

Two edits, both idempotent (safe to run twice, or against a future
Capacitor template that ships its own signingConfigs block by default):

1. Decode ANDROID_KEYSTORE_BASE64 to android/app/release.keystore. This
   file exists only on disk during a CI run (or a local build where the
   env vars happen to be set) â it is gitignored the same way android/
   itself is (see apps/mobile/.gitignore), never committed.
2. Insert a `signingConfigs { release { ... } }` block right inside the
   top-level `android { ... }` block, reading all four values from the
   environment at *Gradle* build time (not baked into the file as literal
   secrets) via System.getenv(...) â then point buildTypes.release at it
   with `signingConfig signingConfigs.release`.
"""
import base64
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MOBILE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..'))
ANDROID_DIR = os.path.join(MOBILE_DIR, 'android')

APP_GRADLE = os.path.join(ANDROID_DIR, 'app', 'build.gradle')
KEYSTORE_DEST = os.path.join(ANDROID_DIR, 'app', 'release.keystore')

REQUIRED_ENV_VARS = (
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
)

SIGNING_CONFIG_BLOCK = """
    signingConfigs {
        release {
            storeFile file('release.keystore')
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }
    }
"""


def main():
    values = {name: os.environ.get(name, '') for name in REQUIRED_ENV_VARS}
    present = [name for name, value in values.items() if value]

    if not present:
        print('no ANDROID_KEYSTORE_* env vars set â skipping release signing '
              '(the build stays unsigned, see android-build.yml\'s debug-APK step)')
        return

    missing = [name for name in REQUIRED_ENV_VARS if not values[name]]
    if missing:
        raise SystemExit(
            'partial release-signing config: '
            f'{", ".join(present)} set but {", ".join(missing)} missing â '
            'all four ANDROID_KEYSTORE_*/ANDROID_KEY_* secrets are required together'
        )

    if not os.path.isdir(ANDROID_DIR):
        raise SystemExit(f'android/ directory not found at {ANDROID_DIR} â run `npx cap add android` first')

    with open(KEYSTORE_DEST, 'wb') as f:
        f.write(base64.b64decode(values['ANDROID_KEYSTORE_BASE64']))
    print(f'decoded ANDROID_KEYSTORE_BASE64 -> {KEYSTORE_DEST}')

    with open(APP_GRADLE, 'r') as f:
        app_contents = f.read()

    if 'signingConfigs {' in app_contents:
        print('app/build.gradle already has a signingConfigs block â skipping insertion')
    else:
        match = re.search(r'(android\s*\{)', app_contents)
        if not match:
            raise SystemExit('could not find the top-level "android {" block in android/app/build.gradle')
        insert_at = match.end()
        app_contents = app_contents[:insert_at] + SIGNING_CONFIG_BLOCK + app_contents[insert_at:]
        print('added signingConfigs block to app/build.gradle')

    if 'signingConfig signingConfigs.release' in app_contents:
        print('release buildType already references signingConfigs.release â skipping')
    else:
        # Targets the specific "release {" buildType block (there is only
        # one, Capacitor's default template never ships a third build type),
        # not the "signingConfigs { release {" block just inserted above â
        # anchored on minifyEnabled, which only ever appears inside
        # buildTypes.release in this file.
        match = re.search(r'(release\s*\{\s*\n\s*minifyEnabled)', app_contents)
        if not match:
            raise SystemExit('could not find the buildTypes "release { minifyEnabled" block in android/app/build.gradle')
        insert_at = match.start(1) + len('release {\n')
        indent_match = re.search(r'\n(\s*)minifyEnabled', app_contents[match.start(1):match.start(1) + 60])
        indent = indent_match.group(1) if indent_match else '            '
        app_contents = (
            app_contents[:insert_at]
            + f'{indent}signingConfig signingConfigs.release\n'
            + app_contents[insert_at:]
        )
        print('wired buildTypes.release.signingConfig to signingConfigs.release')

    with open(APP_GRADLE, 'w') as f:
        f.write(app_contents)


if __name__ == '__main__':
    main()
