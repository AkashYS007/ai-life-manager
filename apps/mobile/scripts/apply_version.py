#!/usr/bin/env python3
"""Sets a real, always-increasing `versionCode` (and a human-readable
`versionName`) on the freshly-scaffolded Android project. Run *after*
`npx cap add android` and *before* `npx cap sync android`, same ordering
as apply_icons.py / apply_firebase_config.py / apply_release_signing.py /
apply_webview_navigation_fix.py / apply_native_notifications.py, and for
the same reason: android/ is regenerated from scratch on every CI run (see
apps/mobile/README.md), so this has to be re-applied here rather than
committed as edited native source.

Play Store submission readiness pass (2026-09-01): before this script,
every build in this workflow left Capacitor's own scaffolded defaults in
place — `versionCode 1` and `versionName "1.0"`, unconditionally, forever.
That's harmless for the very first Play Store upload, but Google Play
requires every *subsequent* upload to carry a strictly greater versionCode
than the one before it — the console rejects a re-upload otherwise. Left
unfixed, the very first post-launch update would be permanently blocked
until this got fixed anyway, so it's addressed now rather than becoming a
one-time fire drill later.

versionCode comes from `GITHUB_RUN_NUMBER` — a real env var GitHub Actions
already sets on every job run, no new secret or repo state needed. It only
ever goes up (GitHub increments it once per workflow run, permanently), so
every build this workflow ever produces is automatically upload-able as a
Play Store update over the last one. versionName (the human-facing "1.2.3"
string shown in Play Store/Settings, which Play Store does *not* require to
be unique or monotonic) is read straight from this package's own
`package.json` "version" field — bump that by hand for a real user-facing
release number; versionCode keeps incrementing underneath it regardless.

Not gated behind any optional secret (unlike apply_release_signing.py) —
this changes nothing about whether a build is signed, so it always runs,
keeping the debug build's versionCode/versionName consistent with the
release build's.
"""
import json
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MOBILE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..'))
ANDROID_DIR = os.path.join(MOBILE_DIR, 'android')

APP_GRADLE = os.path.join(ANDROID_DIR, 'app', 'build.gradle')
PACKAGE_JSON = os.path.join(MOBILE_DIR, 'package.json')


def main():
    if not os.path.isdir(ANDROID_DIR):
        raise SystemExit(f'android/ directory not found at {ANDROID_DIR} — run `npx cap add android` first')

    run_number = os.environ.get('GITHUB_RUN_NUMBER')
    if not run_number or not run_number.isdigit():
        raise SystemExit(
            'GITHUB_RUN_NUMBER is not set (or not numeric). This script expects to run inside a '
            'GitHub Actions job, where GitHub sets that env var automatically on every run. Running '
            'locally instead? Set it yourself first, e.g.:\n'
            '  GITHUB_RUN_NUMBER=1 python3 scripts/apply_version.py'
        )
    version_code = int(run_number)

    with open(PACKAGE_JSON, 'r') as f:
        package = json.load(f)
    version_name = package.get('version') or '1.0.0'

    with open(APP_GRADLE, 'r') as f:
        contents = f.read()

    # Capacitor's scaffolded template always writes these two lines,
    # literally, inside defaultConfig — anchored on the `versionCode`/
    # `versionName` keywords themselves (not on surrounding context), so
    # this is safe regardless of what numbers/strings are currently there,
    # and naturally idempotent: re-running with the same env/package.json
    # just rewrites the same values.
    contents, code_subs = re.subn(r'versionCode\s+\d+', f'versionCode {version_code}', contents)
    if code_subs == 0:
        raise SystemExit('could not find "versionCode <number>" in android/app/build.gradle to replace')

    contents, name_subs = re.subn(r'versionName\s+"[^"]*"', f'versionName "{version_name}"', contents)
    if name_subs == 0:
        raise SystemExit('could not find \'versionName "..."\' in android/app/build.gradle to replace')

    with open(APP_GRADLE, 'w') as f:
        f.write(contents)

    print(f'set versionCode={version_code} (from GITHUB_RUN_NUMBER), versionName="{version_name}" (from package.json)')


if __name__ == '__main__':
    main()
