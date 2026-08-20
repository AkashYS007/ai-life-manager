# @ailm/mobile — native app shell

Wraps the live web app ([www.genzylife.com](https://www.genzylife.com)) in a real Android/iOS app shell using [Capacitor](https://capacitorjs.com/), instead of duplicating the UI in a second codebase. The native `WebView` points straight at production (`server.url` in `capacitor.config.ts`), so every feature ships to the app the moment it ships to the web.

## Why this exists

A browser tab can't give you a real installable icon, native notification channels, or background execution the way an actual app can. This project exists purely to unlock those — not to rebuild the UI.

## Why `android/` and `ios/` aren't committed

Capacitor's `npx cap add android` / `npx cap add ios` scaffold ~50-plus boilerplate files each (gradle wrapper, default resources, an Xcode project, and so on). Committing that tree means it can silently drift from `capacitor.config.ts`, and it makes every diff noisy. Instead, both are regenerated fresh on every build from this directory's config — see `.github/workflows/android-build.yml`, which does exactly that on GitHub's own runners.

## Why the build runs in GitHub Actions, not locally in this repo's usual dev sandbox

The Android Gradle build needs to resolve the Android SDK and AndroidX packages from Google's Maven infrastructure (`maven.google.com` / `dl.google.com`). If you're working from an environment with restricted/allowlisted outbound network access, those domains likely aren't reachable, and `./gradlew assembleDebug` will hang or fail on dependency resolution. GitHub-hosted runners have full network access and the Android SDK preinstalled, so that's where the actual compile happens — trigger it from the Actions tab (`Build Android APK` → `Run workflow`), or just push a change under `apps/mobile/`. The finished APK is attached to the run as a downloadable artifact.

If you do have unrestricted network access locally (e.g. on your own machine with Android Studio installed), the normal Capacitor workflow works fine too:

```bash
cd apps/mobile
npm install
mkdir -p www && echo '<html></html>' > www/index.html   # placeholder; unused at runtime in remote-URL mode
npx cap add android
python3 scripts/apply_icons.py
python3 scripts/apply_firebase_config.py
npx cap sync android
npx cap open android   # opens Android Studio
```

## iOS

`npx cap add ios` scaffolds an Xcode project the same way, but actually building and installing an `.ipa` on a physical iPhone needs a Mac with Xcode, plus either a free Apple ID (7-day local install, re-sign weekly) or a paid Apple Developer account ($99/year) for real distribution or TestFlight. GitHub Actions does have `macos-latest` runners that could build and even sign a release given the right certificates in repo secrets — that's a natural next step once there's an Apple Developer account to sign with, but isn't set up yet.

## Native notification quality (2026-08-20 update)

**Resolved:** notifications used to go through the same web push pipeline the browser version uses (`apps/web/public/sw.js`) — which turned out not to work at all inside the native app, because Android's WebView has no Web Push API (`PushManager`) implementation, with or without a VAPID key. That's why the in-app "notifications button" disappeared the moment this app started loading the real web bundle. The real fix: this app now registers for **Firebase Cloud Messaging** instead (`@capacitor/push-notifications`, wired up in `apps/web/src/components/NativePushRegistration.tsx`, backend delivery in `apps/backend/src/push/native-push.service.ts`). That's genuine OS-level push — delivered by Google Play Services, works with the app fully closed, no service worker or open tab required. `google-services.json` (committed — see that file's presence here and `scripts/apply_firebase_config.py`'s own comment for why it's safe to commit) carries the client-side Firebase config; the sensitive half, the Admin SDK service-account credential the *backend* uses to actually send messages, lives only in Railway's environment as `FIREBASE_SERVICE_ACCOUNT_BASE64` and never touches this repo or this CI workflow.

**Still not built:** automatically reading a notification aloud (voice) with the phone closed. The existing voice-reading feature (`VoiceNotifications.tsx`) only speaks while a page of the app is open — a hard platform limit for a *web* page, and getting it to also fire natively from a background push receipt is meaningfully more work: real Kotlin in `android/app/src/main/java/` (a custom `FirebaseMessagingService` that calls Android's `TextToSpeech` engine directly on receipt), applied as a CI patch step the same way `apply_icons.py`/`apply_firebase_config.py` are, since that directory only exists after `cap add android` runs. Deliberately sequenced as a follow-up after this push fix landed and was verified, at the user's own explicit choice.
