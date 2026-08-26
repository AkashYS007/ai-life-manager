'use client';

import { useEffect } from 'react';
import { apolloClient } from '../lib/apollo-client';
import { VOICE_NOTIFICATIONS_PREF_QUERY } from '../lib/queries';

// Voice notifications increment (explicit user request, 2026-08-19): reads
// each push notification aloud via the Web Speech API the moment it
// arrives, while the app is open. Same "invisible, mounted once, no UI of
// its own" shape as PwaRegister/TimezoneSync.
//
// Deliberately foreground/open-app-only, and this is a hard platform limit,
// not a shortcut: the Web Speech API (`speechSynthesis`) only exists in a
// page's own JS context. That context only exists while some tab/window of
// the app is open — even a backgrounded tab still counts, since its JS
// keeps running, but a fully closed browser or a locked phone does not.
// There is no way to speak a reminder with the app closed or the phone
// locked without a native app (AVSpeechSynthesizer/TextToSpeech) wrapping
// this PWA, which doesn't exist yet — see the matching note on
// PushSubscribeButton for the same "this is device/runtime state, not
// something a preference toggle can override" distinction.
//
// Listens for the postMessage sw.js's `push` handler broadcasts to every
// open client (see sw.js) rather than duplicating any delivery logic here —
// one payload, read once by the OS notification banner and once aloud,
// always in sync because both come from the exact same push event.
//
// Notification controls increment (2026-08-25): this used to speak
// unconditionally, with no way to turn it off — a real gap the user's own
// scorecard flagged. Gated on User.voiceNotificationsEnabled now, checked
// fresh on every incoming push rather than once at mount: this component is
// mounted once, globally, for the lifetime of the whole SPA session (see
// layout.tsx's own comment on why it's outside <Providers>), so a value
// cached only at mount would go stale the moment someone changed the
// preference in Notifications without a full page reload. Uses the plain
// `apolloClient` singleton directly, not the `useQuery` hook — this
// component has no React Apollo *context* to run a hook against (same
// reason it has no auth dependency at all), but the singleton is the same
// client the rest of the app uses, so its normalized cache already reflects
// a preference saved from Notifications (see UPDATE_NOTIFICATION_PREFERENCES's
// own refetchQueries) without a second network round-trip most of the time.
// Fails open (speaks anyway) on a query error — a transient failure here
// should degrade to "the same always-on behavior this had before this
// increment," not silently go mute.
export function VoiceNotifications() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !('serviceWorker' in navigator)) {
      return;
    }

    function speak(payload: { title?: string; body?: string }) {
      const text = [payload.title, payload.body].filter(Boolean).join('. ');
      if (!text) return;
      // Cancel whatever's still queued/speaking first — if reminders land
      // close together, the newest one should be heard, not stack up
      // behind a stale one still being read.
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }

    async function shouldSpeak(): Promise<boolean> {
      try {
        const { data } = await apolloClient.query({
          query: VOICE_NOTIFICATIONS_PREF_QUERY,
          fetchPolicy: 'cache-first',
        });
        // `data?.me` is null/undefined for a signed-out visitor (this
        // component is mounted even on public pages — see its own top
        // comment) — nothing to gate on push-wise for someone who was never
        // signed in to receive a real push in the first place, so this
        // never actually blocks a real notification for a real user.
        return data?.me?.voiceNotificationsEnabled ?? true;
      } catch {
        return true;
      }
    }

    function onMessage(event: MessageEvent) {
      if (event.data && event.data.type === 'ailm-push' && event.data.payload) {
        const payload = event.data.payload;
        void shouldSpeak().then((allowed) => {
          if (allowed) speak(payload);
        });
      }
    }

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  return null;
}
