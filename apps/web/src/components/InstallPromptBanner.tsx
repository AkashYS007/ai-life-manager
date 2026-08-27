'use client';

import { useEffect, useState } from 'react';

// PWA install-prompt increment (2026-08-18). The app has had a correct
// manifest, real icon set, and a working service worker for a while (see
// PwaRegister.tsx and public/sw.js) -- what was missing was ever actually
// telling a visitor the app *can* be installed. Chrome/Edge/Android fire a
// `beforeinstallprompt` event when a page qualifies (valid manifest,
// registered service worker, served over HTTPS) and, critically,
// SUPPRESS THEIR OWN install UI unless a page calls preventDefault() on it
// and holds onto it to trigger later -- so without this component, those
// browsers were silently swallowing the moment entirely. iOS Safari never
// fires that event at all (Apple's deliberate choice); "Add to Home
// Screen" there is a manual step buried in the Share sheet, discoverable
// only if someone already knows to look, so that platform gets its own
// static instructions banner instead of a real button.
//
// Deliberately mounted in layout.tsx alongside <PwaRegister /> -- outside
// <Providers> entirely -- rather than folded into the app shell. This has
// nothing to do with auth or the Apollo cache, and after the 2026-08-18 fix
// to Providers.tsx's cacheReady gate (see that file's comments), keeping
// unrelated concerns decoupled from that gate is exactly the discipline
// that prevents the same class of "entire page silently renders nothing"
// bug from recurring. It also means this banner can offer to install the
// app to a signed-out visitor on the public landing page, which is
// arguably the single best moment to ask.

const DISMISS_KEY = 'ailm-install-prompt-dismissed-at';
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = window.matchMedia?.('(display-mode: standalone)').matches;
  // iOS Safari's own non-standard flag for "launched from the home screen"
  // -- `display-mode: standalone` isn't reliably true there even when the
  // app genuinely was added to the home screen, so both checks matter.
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
  return Boolean(mql || iosStandalone);
}

function recentlyDismissed(): boolean {
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const dismissedAt = Number(raw);
  if (!Number.isFinite(dismissedAt)) return false;
  return Date.now() - dismissedAt < DISMISS_COOLDOWN_MS;
}

export function InstallPromptBanner() {
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null);
  const [installEvent, setInstallEvent] = useState<Event | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Separate from `platform` specifically so the banner mounts in its
  // off-screen/transparent state first, then flips to its resting state a
  // frame later -- that's what actually makes the transition below play,
  // rather than the banner just appearing already in its final position.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!platform) return;
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [platform]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone() || recentlyDismissed()) return;

    const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    if (isIOS) {
      setPlatform('ios');
    }

    function onBeforeInstallPrompt(e: Event) {
      // Chrome's default mini-infobar is suppressed the instant this
      // listener calls preventDefault() -- from here on, this component
      // owns the entire install UI.
      e.preventDefault();
      setInstallEvent(e);
      setPlatform('android');
    }

    function onAppInstalled() {
      setInstallEvent(null);
      setPlatform(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    // Play the same transition in reverse before actually unmounting --
    // 320ms matches `duration-entrance`, the same token the entrance
    // transition uses, so appearing and disappearing feel symmetric.
    setVisible(false);
    window.setTimeout(() => setDismissed(true), 320);
  }

  async function handleInstallClick() {
    const promptEvent = installEvent as (Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
    }) | null;
    if (!promptEvent) return;
    setInstalling(true);
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } finally {
      // Browsers only allow a given beforeinstallprompt event to be
      // consumed once, accepted or not -- clear it either way so a stale
      // reference is never reused.
      setInstalling(false);
      setInstallEvent(null);
      setPlatform(null);
    }
  }

  if (dismissed || !platform) return null;
  if (platform === 'android' && !installEvent) return null;

  return (
    <div
      role="dialog"
      aria-label="Install AI Life Manager"
      // No animation plugin is installed (tailwind.config.ts has an empty
      // plugins array), so the "slide up on appear" effect is a plain CSS
      // transition on transform/opacity, gated by the `visible` state
      // above -- mounts off-screen/transparent, then flips to its resting
      // position one animation frame later so the transition actually
      // plays instead of the banner just appearing already in place.
      className={`fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 transition-all duration-entrance ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
    >
      <div className="flex w-full max-w-md items-start gap-3 rounded-card border border-border bg-surface p-4 shadow-lg dark:border-border-dark dark:bg-surface-dark">
        <img
          src="/icons/icon-192.png"
          alt=""
          className="h-11 w-11 shrink-0 rounded-control"
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
            Install AI Life Manager
          </p>

          {platform === 'android' ? (
            <>
              <p className="mt-0.5 text-xs leading-relaxed text-text-secondary dark:text-text-secondary-dark">
                Add it to your home screen for one-tap access and a full-screen, app-like experience.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleInstallClick}
                  disabled={installing}
                  className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white transition-standard hover:opacity-90 disabled:opacity-60 dark:bg-accent-dark"
                >
                  {installing ? 'Installing…' : 'Install'}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-control px-3 py-2 text-sm font-medium text-text-secondary transition-standard hover:text-text-primary dark:text-text-secondary-dark dark:hover:text-text-primary-dark"
                >
                  Not now
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-0.5 text-xs leading-relaxed text-text-secondary dark:text-text-secondary-dark">
                Tap{' '}
                <span
                  aria-label="the Share icon"
                  className="inline-flex -translate-y-px items-center rounded border border-border px-1 dark:border-border-dark"
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    className="h-3 w-3"
                    aria-hidden="true"
                  >
                    <path
                      d="M10 2v10M6.5 5.5 10 2l3.5 3.5M4 9v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>{' '}
                in Safari&apos;s toolbar, then choose <span className="font-medium">Add to Home Screen</span>.
              </p>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-control px-3 py-2 text-sm font-medium text-text-secondary transition-standard hover:text-text-primary dark:text-text-secondary-dark dark:hover:text-text-primary-dark"
                >
                  Got it
                </button>
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-control p-1 text-text-secondary transition-standard hover:text-text-primary dark:text-text-secondary-dark dark:hover:text-text-primary-dark"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
            <path
              d="m5 5 10 10M15 5 5 15"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
