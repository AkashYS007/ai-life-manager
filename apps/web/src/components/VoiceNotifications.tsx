'use client';

import { useEffect } from 'react';

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

    function onMessage(event: MessageEvent) {
      if (event.data && event.data.type === 'ailm-push' && event.data.payload) {
        speak(event.data.payload);
      }
    }

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  return null;
}
