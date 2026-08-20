'use client';

import { useEffect, useRef } from 'react';
import { useMutation } from '@apollo/client';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { REGISTER_NATIVE_PUSH_TOKEN } from '../lib/queries';

// Native app shell increment (2026-08-20, bug report: "notifications
// button" missing from the installed Android app). Root cause: the
// button's absence was correct behavior, not a bug — PushSubscribeButton
// hides itself whenever `'PushManager' in window` is false, and Android's
// WebView (what apps/mobile's Capacitor shell actually renders through)
// never implements the Push API at all, with or without a VAPID key. This
// component is the real fix: inside the native app specifically, it
// registers this device for Firebase Cloud Messaging instead — real OS-level
// push, delivered by Google Play Services rather than a page's own
// service worker, which is what makes delivery work with the app fully
// closed (see NativePushService's own comment for why that's a genuinely
// different delivery path, not just "the same push with extra steps").
//
// Deliberately auto-registers with no manual "turn on" button of its own —
// unlike PushSubscribeButton, a native app asking the OS for notification
// permission on first use is completely standard, expected UX, not a
// surprise. Mounted in Providers.tsx (needs Apollo + a signed-in user),
// same "invisible, no UI of its own" shape as TimezoneSync/SyncManager.
//
// window.Capacitor only exists when this exact same web bundle is being
// rendered inside the native app's WebView (injected by the Capacitor
// runtime) — on a normal browser tab, `Capacitor.isNativePlatform()`
// returns false and this component does nothing at all, so none of this
// touches the regular PWA/web experience.
export function NativePushRegistration() {
  const [registerToken] = useMutation(REGISTER_NATIVE_PUSH_TOKEN);
  const hasRegistered = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !Capacitor.isNativePlatform() || hasRegistered.current) return;
    hasRegistered.current = true;

    let removeListeners: (() => void) | undefined;

    async function setup() {
      try {
        // High-importance channel so a reminder can actually make sound/
        // heads-up on Android 8+ — without an explicit channel, FCM falls
        // back to a generic "Miscellaneous" channel a person is more likely
        // to have muted. Matches the `channelId: 'reminders'` the backend
        // sends in NativePushService.sendToUser's android.notification
        // block.
        await PushNotifications.createChannel({
          id: 'reminders',
          name: 'Reminders',
          description: 'Break, water, habit, and routine reminders',
          importance: 5,
          visibility: 1,
          vibration: true,
        });

        const permission = await PushNotifications.checkPermissions();
        const granted =
          permission.receive === 'granted' ||
          (await PushNotifications.requestPermissions()).receive === 'granted';
        if (!granted) return;

        const registrationListener = await PushNotifications.addListener('registration', (token) => {
          registerToken({ variables: { input: { token: token.value, platform: 'ANDROID' } } }).catch(() => {
            // Best-effort, same as TimezoneSync's own silent-retry-next-mount
            // approach — nothing else in the app depends on this succeeding
            // synchronously, and the OS will hand this device the same
            // token again next time register() runs.
          });
        });

        const errorListener = await PushNotifications.addListener('registrationError', () => {
          // Nothing actionable to show — same "best-effort, never surface a
          // delivery-channel failure to the person mid-task" principle
          // WebPushService/NativePushService both already follow server-side.
        });

        // Foreground receipt hook — registered so the plugin doesn't warn
        // about an unhandled event, and as the extension point for the
        // still-unbuilt background-voice follow-up (explicitly deferred by
        // the person this shipped for — see apps/mobile/README.md). Doesn't
        // yet feed VoiceNotifications: that component listens on
        // `navigator.serviceWorker`'s own message channel (messages a
        // service worker sends to its page), which is a different event
        // target than this plugin callback — wiring the two together
        // belongs to that follow-up, not this pass, and a naive
        // `window.postMessage` here would silently never reach it.
        const receivedListener = await PushNotifications.addListener('pushNotificationReceived', () => {});

        removeListeners = () => {
          registrationListener.remove();
          errorListener.remove();
          receivedListener.remove();
        };

        await PushNotifications.register();
      } catch {
        // Best-effort — a Play Services hiccup or a plugin call failing on
        // some device shouldn't block the rest of the app from working.
        hasRegistered.current = false;
      }
    }

    setup();
    return () => removeListeners?.();
  }, [registerToken]);

  return null;
}
