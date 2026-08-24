#!/usr/bin/env python3
"""Voice + reliable-banner notifications increment (2026-08-20). Run *after*
`npx cap add android` and *before* `npx cap sync android`, same ordering and
same "android/ is regenerated from scratch every CI run, so this has to be
re-applied here" reasoning as apply_icons.py, apply_firebase_config.py, and
apply_webview_navigation_fix.py.

Backstory: native-push.service.ts sends a data-only FCM message (no
top-level `notification`, no `android.notification` override — see that
file's own comment for exactly why, and for the two earlier shapes that were
tried and didn't work). A data-only message is the *only* shape that
reliably calls this app's FirebaseMessagingService.onMessageReceived() no
matter what state the app is in — foreground, backgrounded, or fully
killed. Any message that includes a `notification` payload gets
auto-displayed by the OS instead when the app isn't in the foreground, and
onMessageReceived() is never called at all in that case — which is exactly
why the very first fix (adding a top-level `notification` block to get the
banner working) had to be reverted here: it fixed the banner, but by a
mechanism that's fundamentally incompatible with ever running real code
(like speaking the reminder out loud) when the app isn't open.

The `@capacitor/push-notifications` plugin's own default
FirebaseMessagingService (com.capacitorjs.plugins.pushnotifications.
MessagingService, contributed by that plugin's own AAR manifest, not
something this repo owns or can edit directly) only ever forwards a
received message to this app's JS — nothing shows a banner and nothing
speaks unless the app's JS is actually running to react to it, which is the
same gap the original 2026-08-20 push implementation already flagged as its
one deliberately-deferred follow-up.

This script removes that default service (via a `tools:node="remove"`
manifest override — the standard, documented way to drop a component an
AAR contributes when the app needs to fully own that responsibility
instead) and replaces it with AiLifeManagerMessagingService, a subclass of
Capacitor's own service (so the existing JS-side registration/foreground
listener behavior keeps working completely unchanged) that additionally
builds a real notification banner and speaks the reminder out loud using
Android's on-device text-to-speech engine, every time, regardless of app
state — because onMessageReceived() now genuinely always runs, in every
app state, for every message this app sends.
"""
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MOBILE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, '..'))
JAVA_DIR = os.path.join(
    MOBILE_DIR, 'android', 'app', 'src', 'main', 'java', 'com', 'genzylife', 'ailifemanager'
)
SERVICE_FILE = os.path.join(JAVA_DIR, 'AiLifeManagerMessagingService.java')
MANIFEST_FILE = os.path.join(MOBILE_DIR, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')

SERVICE_CONTENT = """package com.genzylife.ailifemanager;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Locale;
import java.util.Map;

// Voice + reliable-banner notifications increment (2026-08-20). See
// scripts/apply_native_notifications.py's own comment for the full story
// on why this exists as a real native class instead of staying in JS --
// short version: a data-only FCM message (see native-push.service.ts's own
// comment on this same date) is the only shape that reliably wakes this
// exact class's onMessageReceived below no matter what state the app is
// in -- foreground, backgrounded, or fully killed -- and reliably waking
// native code in every one of those states is the whole point of this
// feature: the phone speaking a reminder out loud, and showing a real
// notification banner, even with the app not open at all.
//
// Extends Capacitor's own MessagingService (not FirebaseMessagingService
// directly) so the existing JS-side behavior -- the 'registration' token
// listener and the foreground 'pushNotificationReceived' listener in
// NativePushRegistration.tsx -- keeps working completely unchanged; this
// class only ever *adds* the banner+voice behavior below super's own
// handling, never replaces it.
public class AiLifeManagerMessagingService extends MessagingService {

    // Matches the channel NativePushRegistration.tsx already creates on
    // every app launch (PushNotifications.createChannel({id: 'reminders',
    // ...})) -- reused here rather than invented separately so this
    // service's own notifications land in the same channel a person would
    // already find and configure (mute, change importance, etc.) for every
    // other reminder this app sends. Also created here directly, real
    // fields and all, as a defensive fallback for the one edge case where
    // this service's process gets woken by FCM to handle a message before
    // the app has ever actually been opened once to run that JS -- an
    // Android O+ notify() call against a channel id that doesn't exist yet
    // would otherwise silently do nothing at all.
    private static final String CHANNEL_ID = "reminders";
    private static final String CHANNEL_NAME = "Reminders";

    // Kept alive for the lifetime of this process rather than created fresh
    // per message -- TextToSpeech's own engine startup is genuinely slow
    // (a real, user-noticeable delay before the first word), and this
    // service's process very often stays alive to receive more than one
    // reminder in the same session.
    private static TextToSpeech tts;
    private static int notificationIdCounter = 5000;

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        // Unchanged existing behavior first -- JS-side foreground listener,
        // token refresh handling, everything Capacitor's own
        // MessagingService already did before this class existed.
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        String title = data.get("title");
        String body = data.get("body");
        String deeplink = data.get("deeplink");
        // Guards against any future FCM traffic this app might ever send
        // that isn't one of NativePushService's own reminder pushes (none
        // exist today, but this class shouldn't assume that stays true
        // forever) -- nothing to show or say without at least one of these.
        if ((title == null || title.isEmpty()) && (body == null || body.isEmpty())) {
            return;
        }

        showBanner(title, body, deeplink);
        speakIfPhoneIsAudible(title, body);
    }

    private void showBanner(String title, String body, String deeplink) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (deeplink != null) {
            intent.putExtra("deeplink", deeplink);
        }
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent contentIntent = PendingIntent.getActivity(this, notificationIdCounter, intent, piFlags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            // The launcher icon, not a dedicated monochrome status-bar
            // icon -- a real, deliberate visual polish gap (Android may
            // render a full-color icon as a plain silhouette in the status
            // bar on some versions), not a functional one; tracked as a
            // follow-up, not blocking real delivery working at all.
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(contentIntent);

        manager.notify(notificationIdCounter++, builder.build());
    }

    // Voice notifications increment: speaks the reminder out loud using
    // Android's on-device text-to-speech engine -- skipped entirely if the
    // phone is silenced or on vibrate (AudioManager's ringer mode is the
    // same signal a normal notification sound would already respect), per
    // the person's own explicit choice not to have this override silent
    // mode the way an alarm would.
    private void speakIfPhoneIsAudible(String title, String body) {
        AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null || audioManager.getRingerMode() != AudioManager.RINGER_MODE_NORMAL) {
            return;
        }

        StringBuilder toSpeak = new StringBuilder();
        if (title != null) toSpeak.append(title);
        if (body != null) {
            if (toSpeak.length() > 0) toSpeak.append(". ");
            toSpeak.append(body);
        }
        if (toSpeak.length() == 0) return;
        String utterance = toSpeak.toString();
        String utteranceId = "ail_reminder_" + System.currentTimeMillis();

        if (tts != null) {
            tts.speak(utterance, TextToSpeech.QUEUE_ADD, null, utteranceId);
            return;
        }

        // Queued and spoken from inside the init callback rather than right
        // after construction -- TextToSpeech's constructor returns
        // immediately, long before the engine is actually ready, and a
        // speak() call before that point is silently dropped.
        tts = new TextToSpeech(getApplicationContext(), status -> {
            if (status != TextToSpeech.SUCCESS || tts == null) return;
            int langResult = tts.setLanguage(Locale.getDefault());
            if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                tts.setLanguage(Locale.US);
            }
            tts.speak(utterance, TextToSpeech.QUEUE_ADD, null, utteranceId);
        });
    }
}
"""

MANIFEST_SERVICE_BLOCK = """
        <!-- Voice + reliable-banner notifications increment (2026-08-20):
             see AiLifeManagerMessagingService's own comment for the full
             story. Removes the @capacitor/push-notifications plugin's own
             default FirebaseMessagingService (contributed by its AAR's own
             manifest at build time, so it can't just be deleted at the
             source) and replaces it with a subclass that does everything
             the original did, plus shows a real notification banner and
             speaks the reminder out loud, every FCM message this app
             sends still needs exactly one component actually receiving it,
             so this is a replace, not an addition. -->
        <service android:name="com.capacitorjs.plugins.pushnotifications.MessagingService" tools:node="remove" />
        <service android:name=".AiLifeManagerMessagingService" android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>
    </application>"""


def write_service():
    if not os.path.isdir(JAVA_DIR):
        raise SystemExit(f'{JAVA_DIR} not found — run `npx cap add android` first')
    with open(SERVICE_FILE, 'w') as f:
        f.write(SERVICE_CONTENT)
    print(f'wrote {SERVICE_FILE}')


def patch_manifest():
    if not os.path.isfile(MANIFEST_FILE):
        raise SystemExit(f'{MANIFEST_FILE} not found — run `npx cap add android` first')
    with open(MANIFEST_FILE) as f:
        manifest = f.read()

    if 'AiLifeManagerMessagingService' in manifest:
        print('manifest already patched, skipping')
        return

    old_root = '<manifest xmlns:android="http://schemas.android.com/apk/res/android">'
    new_root = (
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android" '
        'xmlns:tools="http://schemas.android.com/tools">'
    )
    if old_root not in manifest:
        raise SystemExit(
            'AndroidManifest.xml root <manifest> tag did not match the expected '
            'Capacitor-generated shape — refusing to patch blind, update this '
            'script to match the new shape.'
        )
    manifest = manifest.replace(old_root, new_root, 1)

    old_close = '    </application>'
    if manifest.count(old_close) != 1:
        raise SystemExit(
            f'expected exactly one "{old_close}" in AndroidManifest.xml, found '
            f'{manifest.count(old_close)} — refusing to patch blind.'
        )
    manifest = manifest.replace(old_close, MANIFEST_SERVICE_BLOCK, 1)

    with open(MANIFEST_FILE, 'w') as f:
        f.write(manifest)
    print(f'patched {MANIFEST_FILE}')


def main():
    write_service()
    patch_manifest()


if __name__ == '__main__':
    main()
