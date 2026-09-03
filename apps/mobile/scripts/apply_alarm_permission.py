#!/usr/bin/env python3
"""Adds the one Android permission the wake-up alarm feature actually needs
(and that this repo's own docs originally, wrongly, said it didn't) — see
apps/mobile/README.md's "Wake-up alarm" section for where that mistake is
now corrected. Run *after* `npx cap add android` (which creates
AndroidManifest.xml in the first place) and *before* `npx cap sync android`,
same ordering as every other apply_*.py step in this job, since android/ is
regenerated from scratch on every CI run.

Found via real live-device testing (2026-09-03), not assumed from docs:
`@capgo/capacitor-alarm`'s createAlarm() just fires a plain implicit
android.intent.action.SET_ALARM Intent at whatever Activity on the device
wants to handle it (see the plugin's own
android/src/main/java/.../CapgoAlarmPlugin.java — no AlarmManager, no
special API, and critically no permission handling of its own; the plugin's
bundled AndroidManifest.xml is empty). That part of Update 68's own
reasoning was right. What Update 68 got wrong: Google's own stock Clock app
(com.google.android.deskclock) enforces the caller hold
com.android.alarm.permission.SET_ALARM before its ACTION_SET_ALARM receiver
will accept the Intent at all — undocumented in the plugin's own README,
and the kind of thing that only ever shows up as a real
SecurityException/"Permission Denial" at runtime on a real device, which is
exactly what happened: a real Pixel running this app hit
`Permission Denial: starting Intent { act=android.intent.action.SET_ALARM
... } requires com.android.alarm.permission.SET_ALARM`, caught by the
plugin's own try/catch and surfaced verbatim through this app's
syncPhoneAlarm() status message.

com.android.alarm.permission.SET_ALARM has been a *normal* (not
dangerous/runtime-prompted) permission since Android's earliest API levels —
declaring it in the manifest is enough; there's no runtime consent dialog
for the user to grant, unlike location/camera/etc.
"""
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MOBILE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..'))
MANIFEST_FILE = os.path.join(MOBILE_DIR, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')

PERMISSION_LINE = '    <uses-permission android:name="com.android.alarm.permission.SET_ALARM" />\n'

# Anchor on the one <uses-permission> line Capacitor's own android template
# always scaffolds (confirmed directly against a fresh `npx cap add android`
# run, 2026-09-03) — inserting right after it keeps every permission this
# app declares together in one place, rather than scattered across the file.
ANCHOR = '    <uses-permission android:name="android.permission.INTERNET" />\n'


def main():
    if not os.path.isfile(MANIFEST_FILE):
        raise SystemExit(f'{MANIFEST_FILE} not found — run `npx cap add android` first')
    with open(MANIFEST_FILE) as f:
        manifest = f.read()

    if 'com.android.alarm.permission.SET_ALARM' in manifest:
        print('manifest already has the alarm permission, skipping')
        return

    if manifest.count(ANCHOR) != 1:
        raise SystemExit(
            f'expected exactly one INTERNET <uses-permission> line in '
            f'AndroidManifest.xml to anchor on, found {manifest.count(ANCHOR)} '
            f'— refusing to patch blind, update this script to match the new shape.'
        )
    manifest = manifest.replace(ANCHOR, ANCHOR + PERMISSION_LINE, 1)

    with open(MANIFEST_FILE, 'w') as f:
        f.write(manifest)
    print(f'patched {MANIFEST_FILE} with com.android.alarm.permission.SET_ALARM')


if __name__ == '__main__':
    main()
