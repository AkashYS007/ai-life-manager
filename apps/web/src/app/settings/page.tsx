'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@apollo/client';
import {
  SETTINGS_QUERY,
  UPDATE_SETTINGS,
  DELETE_ACCOUNT,
  CHANGE_SUBSCRIPTION_TIER,
  CREATE_CHECKOUT_SESSION,
  CREATE_BILLING_PORTAL_SESSION,
} from '../../lib/queries';
import { BottomNav } from '../../components/BottomNav';
import { apolloClient, runClerkSignOutIfAvailable, openClerkUserProfile } from '../../lib/apollo-client';

const isDevAuth = process.env.NEXT_PUBLIC_AUTH_MODE === 'dev';

// Real Stripe billing integration. Prices here are still plain display
// copy, not read from a live Stripe Price object — the numbers must be
// kept in sync by hand with whatever STRIPE_PRICE_ID_PLUS/
// STRIPE_PRICE_ID_PRO actually charge in the Stripe Dashboard, the same
// "display copy, not a source of truth" caveat this list already carried
// before this increment (see the README for the honest note on this).
const TIER_OPTIONS: Array<{ value: 'FREE' | 'PLUS' | 'PRO'; label: string; price: string }> = [
  { value: 'FREE', label: 'Free', price: '$0/mo' },
  { value: 'PLUS', label: 'Plus', price: '$6/mo' },
  { value: 'PRO', label: 'Pro', price: '$12/mo' },
];

// Reads `?checkout=success|cancel` — set by StripeService's own
// success_url/cancel_url after a real Checkout redirect completes (see
// billing/stripe.service.ts). Split into its own tiny component (rather
// than calling useSearchParams directly in SettingsPage) purely for the
// Suspense-boundary requirement useSearchParams carries — same reasoning/
// precedent as GoogleCalendarConnect.tsx and Onboarding's own Suspense
// wrapping.
function CheckoutResultBanner() {
  const searchParams = useSearchParams();
  const result = searchParams.get('checkout'); // 'success' | 'cancel' | null
  if (result === 'success') {
    return (
      <p className="mx-4 mb-3 text-xs text-accent dark:text-accent-dark" role="status">
        Checkout complete — this can take a few seconds to show up below while Stripe's own confirmation arrives.
      </p>
    );
  }
  if (result === 'cancel') {
    return (
      <p className="mx-4 mb-3 text-xs text-text-secondary dark:text-text-secondary-dark" role="status">
        Checkout was canceled — your plan hasn&apos;t changed.
      </p>
    );
  }
  return null;
}

function formatRenewalDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  CANCELED: 'Canceled',
  TRIALING: 'Trialing',
};

// Same labels as the onboarding quiz's own chronotype question
// (app/onboarding/page.tsx) — this screen is editing the same answer, not a
// different one, so it should read the same way wherever it's asked.
const CHRONOTYPE_OPTIONS: Array<{ label: string; value: 'EARLY_BIRD' | 'NIGHT_OWL' | 'NEUTRAL' }> = [
  { label: 'Morning person', value: 'EARLY_BIRD' },
  { label: 'Night owl', value: 'NIGHT_OWL' },
  { label: 'Neither, really', value: 'NEUTRAL' },
];

// Visible settings screen increment — closes the README's own long-standing
// "onboarding answers can't be edited afterward, and there's no settings
// screen" gap. Every field here already had a real column and a real
// mutation (`updateProfile`) before this page existed — chronotype and
// timezone since the very first profile increment, work hours since
// Diagnostic onboarding — the gap was purely the missing UI, not missing
// backend support. The one genuinely new piece of backend logic
// (`timezoneManual`) exists only to keep TimezoneSync.tsx's own silent
// browser-detection write from immediately undoing whatever a person
// chooses here.
export default function SettingsPage() {
  const router = useRouter();
  const { data, loading } = useQuery(SETTINGS_QUERY);
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [timezoneManual, setTimezoneManual] = useState(false);
  const [chronotype, setChronotype] = useState<'EARLY_BIRD' | 'NIGHT_OWL' | 'NEUTRAL' | ''>('');
  const [workHoursStart, setWorkHoursStart] = useState('');
  const [workHoursEnd, setWorkHoursEnd] = useState('');
  // Configurable Pomodoro durations increment — plain text state (not
  // number) same as every other numeric-ish input on this page's sibling
  // forms (see HabitManageRow's protectedDurationMinutes for the identical
  // "string state, parse on save, empty string means unset" pattern) —
  // lets the field be genuinely empty (falls back to the fixed default)
  // rather than forcing it to always hold some number.
  const [pomodoroWorkMinutes, setPomodoroWorkMinutes] = useState('');
  const [pomodoroShortBreakMinutes, setPomodoroShortBreakMinutes] = useState('');
  const [pomodoroLongBreakMinutes, setPomodoroLongBreakMinutes] = useState('');
  const [pomodoroCyclesBeforeLongBreak, setPomodoroCyclesBeforeLongBreak] = useState('');
  // Configurable reminder windows/thresholds increment — same string-state/
  // parse-on-save pattern as the Pomodoro fields just above.
  const [reminderMorningRoutineHour, setReminderMorningRoutineHour] = useState('');
  const [reminderEveningRoutineHour, setReminderEveningRoutineHour] = useState('');
  const [reminderReflectionHour, setReminderReflectionHour] = useState('');
  const [reminderHabitMinOverdueMinutes, setReminderHabitMinOverdueMinutes] = useState('');
  const [reminderHabitMaxOverdueMinutes, setReminderHabitMaxOverdueMinutes] = useState('');
  // Configurable daily reflection questions increment — plain string state,
  // same as every other field on this form; empty string means "use the
  // classic wording," resolved client-side in /reflection.
  const [reflectionWentWellLabel, setReflectionWentWellLabel] = useState('');
  const [reflectionChallengingLabel, setReflectionChallengingLabel] = useState('');
  const [reflectionCarryForwardLabel, setReflectionCarryForwardLabel] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Account deletion increment — its own separate state, deliberately not
  // sharing `error`/`saved` above since this is a different action with a
  // different failure mode.
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Real billing/subscription management increment — its own separate
  // error state too, same reasoning as account deletion above: a failed
  // plan switch shouldn't show up attached to the unrelated profile-save
  // form.
  const [tierError, setTierError] = useState<string | null>(null);

  if (!initialized && data?.me) {
    setDisplayName(data.me.displayName ?? '');
    setTimezone(data.me.timezone ?? '');
    setTimezoneManual(data.me.timezoneManual ?? false);
    setChronotype(data.me.chronotype ?? '');
    setWorkHoursStart(data.me.workHoursStart ?? '');
    setWorkHoursEnd(data.me.workHoursEnd ?? '');
    setPomodoroWorkMinutes(data.me.pomodoroWorkMinutes?.toString() ?? '');
    setPomodoroShortBreakMinutes(data.me.pomodoroShortBreakMinutes?.toString() ?? '');
    setPomodoroLongBreakMinutes(data.me.pomodoroLongBreakMinutes?.toString() ?? '');
    setPomodoroCyclesBeforeLongBreak(data.me.pomodoroCyclesBeforeLongBreak?.toString() ?? '');
    setReminderMorningRoutineHour(data.me.reminderMorningRoutineHour?.toString() ?? '');
    setReminderEveningRoutineHour(data.me.reminderEveningRoutineHour?.toString() ?? '');
    setReminderReflectionHour(data.me.reminderReflectionHour?.toString() ?? '');
    setReminderHabitMinOverdueMinutes(data.me.reminderHabitMinOverdueMinutes?.toString() ?? '');
    setReminderHabitMaxOverdueMinutes(data.me.reminderHabitMaxOverdueMinutes?.toString() ?? '');
    setReflectionWentWellLabel(data.me.reflectionWentWellLabel ?? '');
    setReflectionChallengingLabel(data.me.reflectionChallengingLabel ?? '');
    setReflectionCarryForwardLabel(data.me.reflectionCarryForwardLabel ?? '');
    setInitialized(true);
  }

  const [updateSettings, { loading: saving }] = useMutation(UPDATE_SETTINGS, {
    refetchQueries: [{ query: SETTINGS_QUERY }],
  });
  const [deleteAccount, { loading: deleting }] = useMutation(DELETE_ACCOUNT);
  const [changeSubscriptionTier, { loading: changingTier }] = useMutation(CHANGE_SUBSCRIPTION_TIER, {
    refetchQueries: [{ query: SETTINGS_QUERY }],
  });
  const [createCheckoutSession, { loading: checkingOut }] = useMutation(CREATE_CHECKOUT_SESSION);
  const [createBillingPortalSession, { loading: openingPortal }] = useMutation(CREATE_BILLING_PORTAL_SESSION);

  const browserDetected = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;

  async function handleSave() {
    setSaved(false);
    setError(null);
    try {
      const result = await updateSettings({
        variables: {
          input: {
            displayName: displayName.trim() || null,
            timezone: timezone.trim() || undefined,
            timezoneManual,
            chronotype: chronotype || null,
            workHoursStart: workHoursStart || null,
            workHoursEnd: workHoursEnd || null,
            pomodoroWorkMinutes: pomodoroWorkMinutes.trim() ? parseInt(pomodoroWorkMinutes, 10) : null,
            pomodoroShortBreakMinutes: pomodoroShortBreakMinutes.trim() ? parseInt(pomodoroShortBreakMinutes, 10) : null,
            pomodoroLongBreakMinutes: pomodoroLongBreakMinutes.trim() ? parseInt(pomodoroLongBreakMinutes, 10) : null,
            pomodoroCyclesBeforeLongBreak: pomodoroCyclesBeforeLongBreak.trim()
              ? parseInt(pomodoroCyclesBeforeLongBreak, 10)
              : null,
            reminderMorningRoutineHour: reminderMorningRoutineHour.trim()
              ? parseInt(reminderMorningRoutineHour, 10)
              : null,
            reminderEveningRoutineHour: reminderEveningRoutineHour.trim()
              ? parseInt(reminderEveningRoutineHour, 10)
              : null,
            reminderReflectionHour: reminderReflectionHour.trim() ? parseInt(reminderReflectionHour, 10) : null,
            reminderHabitMinOverdueMinutes: reminderHabitMinOverdueMinutes.trim()
              ? parseInt(reminderHabitMinOverdueMinutes, 10)
              : null,
            reminderHabitMaxOverdueMinutes: reminderHabitMaxOverdueMinutes.trim()
              ? parseInt(reminderHabitMaxOverdueMinutes, 10)
              : null,
            reflectionWentWellLabel: reflectionWentWellLabel.trim() || null,
            reflectionChallengingLabel: reflectionChallengingLabel.trim() || null,
            reflectionCarryForwardLabel: reflectionCarryForwardLabel.trim() || null,
          },
        },
      });
      const errors = result.data?.updateProfile?.errors ?? [];
      if (errors.length > 0) {
        setError(errors[0].message ?? "Couldn't save those settings. Try again.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Couldn't save those settings. Try again.");
    }
  }

  // "Use browser-detected automatically" — clears the manual flag and, if a
  // real detected timezone is available, fills the field with it too, so
  // Save immediately reflects what TimezoneSync would have set on its own
  // rather than leaving a stale manually-typed value sitting in the input.
  function useAutomaticTimezone() {
    setTimezoneManual(false);
    if (browserDetected) setTimezone(browserDetected);
  }

  // Real Stripe billing integration. Simulated switching (immediate,
  // no-confirmation-needed — see the original comment on this, still
  // accurate) is now the *fallback*, used only once createCheckoutSession
  // reports the server has no real Stripe keys configured, or for
  // downgrading straight back to FREE (Checkout only ever starts a new
  // paid subscription — there's nothing to "check out" for going to $0).
  // Once a real Stripe customer exists (`hasStripeCustomer`), this handler
  // is never called at all — the Plan buttons become read-only and
  // "Manage billing" (handleManageBilling below) takes over, since
  // changing an *existing* Stripe subscription's price needs Stripe's own
  // proration handling, not a blind tier overwrite.
  async function handleChangeTier(tier: 'FREE' | 'PLUS' | 'PRO') {
    setTierError(null);
    try {
      const result = await changeSubscriptionTier({ variables: { tier } });
      const errors = result.data?.changeSubscriptionTier?.errors ?? [];
      if (errors.length > 0) {
        setTierError(errors[0].message ?? "Couldn't switch your plan. Try again.");
      }
    } catch {
      setTierError("Couldn't switch your plan. Try again.");
    }
  }

  // Full browser navigation to Stripe's own hosted Checkout page — same
  // `window.location.href = payload.xUrl` shape GoogleCalendarConnect.tsx
  // already established for handing off to a third party's own flow.
  async function handleUpgrade(tier: 'PLUS' | 'PRO') {
    setTierError(null);
    try {
      const result = await createCheckoutSession({ variables: { tier } });
      const payload = result.data?.createCheckoutSession;
      if (payload?.checkoutUrl) {
        window.location.href = payload.checkoutUrl;
        return;
      }
      const errors = payload?.errors ?? [];
      if (errors[0]?.code === 'STRIPE_NOT_CONFIGURED') {
        // Graceful degradation — same "still usable in a lesser form
        // without the third-party key" pattern Chat/the AI planner already
        // follow for a missing ANTHROPIC_API_KEY.
        await handleChangeTier(tier);
        return;
      }
      setTierError(errors[0]?.message ?? "Couldn't start checkout. Try again.");
    } catch {
      setTierError("Couldn't start checkout. Try again.");
    }
  }

  function handleTierClick(tier: 'FREE' | 'PLUS' | 'PRO', hasStripeCustomer: boolean) {
    if (hasStripeCustomer) return; // buttons are disabled in this state — see the plan-picker JSX below
    if (tier === 'FREE') {
      handleChangeTier('FREE');
      return;
    }
    handleUpgrade(tier);
  }

  async function handleManageBilling() {
    setTierError(null);
    try {
      const result = await createBillingPortalSession();
      const payload = result.data?.createBillingPortalSession;
      if (payload?.portalUrl) {
        window.location.href = payload.portalUrl;
        return;
      }
      setTierError(payload?.errors?.[0]?.message ?? "Couldn't open billing management. Try again.");
    } catch {
      setTierError("Couldn't open billing management. Try again.");
    }
  }

  // Account deletion increment. The API itself takes no confirmation input
  // (see queries.ts's own note) — this "type DELETE to confirm" gate is
  // purely a frontend affordance, matching this app's existing pattern of
  // single-tap delete buttons elsewhere but with an extra step given how
  // much more this one action destroys. On success: clear the local Apollo
  // cache (nothing it's holding is valid anymore), end the real Clerk
  // session if one exists (AUTH_MODE=dev has none — see apollo-client.ts's
  // runClerkSignOutIfAvailable), then redirect. AUTH_MODE=dev has no
  // Clerk-hosted /sign-in page to send someone to (it isn't wrapped in
  // <ClerkProvider> at all — see Providers.tsx), so it goes to /today
  // instead, where the exact same dev identity immediately gets a brand
  // new, empty account provisioned for it.
  async function handleDeleteAccount() {
    setDeleteError(null);
    try {
      const result = await deleteAccount();
      const errors = result.data?.deleteAccount?.errors ?? [];
      if (errors.length > 0) {
        setDeleteError(errors[0].message ?? "Couldn't delete your account. Try again.");
        return;
      }
      await apolloClient.clearStore();
      await runClerkSignOutIfAvailable();
      router.push(isDevAuth ? '/today' : '/sign-in');
    } catch {
      setDeleteError("Couldn't delete your account. Try again.");
    }
  }

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Settings</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Name, timezone, chronotype, and work hours — the answers from onboarding, editable here going forward.
        </p>
      </div>

      <Suspense fallback={null}>
        <CheckoutResultBanner />
      </Suspense>

      {loading && !initialized && (
        <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>
      )}

      {(!loading || initialized) && (
        <div className="mx-4 mb-4 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
          <h2 className="mb-1 text-sm font-medium text-text-primary dark:text-text-primary-dark">Name</h2>
          <label htmlFor="display-name-input" className="mb-1 block text-xs text-text-secondary dark:text-text-secondary-dark">
            Display name
          </label>
          <input
            id="display-name-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Not set"
            className="w-full rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            Used in greetings around the app (e.g. Today's "Good morning, ___"). Leave blank to fall back to the
            part of your email before the @.
          </p>

          <h2 className="mb-1 mt-4 text-sm font-medium text-text-primary dark:text-text-primary-dark">Timezone</h2>
          <label htmlFor="timezone-input" className="mb-1 block text-xs text-text-secondary dark:text-text-secondary-dark">
            IANA timezone (e.g. America/New_York)
          </label>
          <input
            id="timezone-input"
            type="text"
            value={timezone}
            onChange={(e) => {
              setTimezone(e.target.value);
              setTimezoneManual(true);
            }}
            className="w-full rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            {timezoneManual
              ? "Set manually — this app won't override it with your browser's detected timezone anymore."
              : "Syncing automatically from your browser. Editing the field above switches to manual."}
          </p>
          {timezoneManual && (
            <button
              type="button"
              onClick={useAutomaticTimezone}
              className="mt-2 text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark"
            >
              Use browser-detected automatically{browserDetected ? ` (${browserDetected})` : ''}
            </button>
          )}

          <h2 className="mb-1 mt-4 text-sm font-medium text-text-primary dark:text-text-primary-dark">Chronotype</h2>
          <label htmlFor="chronotype-select" className="mb-1 block text-xs text-text-secondary dark:text-text-secondary-dark">
            When do you tend to feel most energized?
          </label>
          <select
            id="chronotype-select"
            value={chronotype}
            onChange={(e) => setChronotype(e.target.value as 'EARLY_BIRD' | 'NIGHT_OWL' | 'NEUTRAL' | '')}
            className="w-full rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">Not set</option>
            {CHRONOTYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <h2 className="mb-1 mt-4 text-sm font-medium text-text-primary dark:text-text-primary-dark">Work hours</h2>
          <div className="flex items-center gap-3">
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              From
              <input
                type="time"
                value={workHoursStart}
                onChange={(e) => setWorkHoursStart(e.target.value)}
                className="ml-2 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
            </label>
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              to
              <input
                type="time"
                value={workHoursEnd}
                onChange={(e) => setWorkHoursEnd(e.target.value)}
                className="ml-2 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
            </label>
          </div>
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            Used by the AI daily planner to decide when tasks can be scheduled. Leave both blank to use the default
            (7am–9pm).
          </p>

          {/* Configurable Pomodoro durations increment — closes "Pomodoro
              mode's cadence is fixed" from the README's own "not built yet"
              list. Same "leave blank for the default" pattern as Work hours
              just above, applied to the four numbers /focus's Pomodoro mode
              used to hardcode. */}
          <h2 className="mb-1 mt-4 text-sm font-medium text-text-primary dark:text-text-primary-dark">
            Pomodoro durations
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Work
              <input
                type="number"
                min={5}
                max={120}
                value={pomodoroWorkMinutes}
                onChange={(e) => setPomodoroWorkMinutes(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="25"
                aria-label="Pomodoro work minutes"
                className="ml-2 w-16 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
              <span className="ml-1">min</span>
            </label>
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Short break
              <input
                type="number"
                min={1}
                max={60}
                value={pomodoroShortBreakMinutes}
                onChange={(e) => setPomodoroShortBreakMinutes(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="5"
                aria-label="Pomodoro short break minutes"
                className="ml-2 w-16 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
              <span className="ml-1">min</span>
            </label>
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Long break
              <input
                type="number"
                min={1}
                max={180}
                value={pomodoroLongBreakMinutes}
                onChange={(e) => setPomodoroLongBreakMinutes(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="15"
                aria-label="Pomodoro long break minutes"
                className="ml-2 w-16 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
              <span className="ml-1">min</span>
            </label>
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Long break every
              <input
                type="number"
                min={2}
                max={12}
                value={pomodoroCyclesBeforeLongBreak}
                onChange={(e) => setPomodoroCyclesBeforeLongBreak(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="4"
                aria-label="Long break every N cycles"
                className="ml-2 w-16 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
              <span className="ml-1">cycles</span>
            </label>
          </div>
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            Used by Pomodoro mode on the Focus screen. Leave any of these blank to use the classic default (25 min
            work · 5 min short break · 15 min long break · every 4th cycle).
          </p>

          {/* Configurable reminder windows/thresholds increment — closes
              "Reminder windows and thresholds are fixed, not configurable"
              from the README's own "not built yet" list. Same "leave blank
              for the default" pattern as Pomodoro durations just above. */}
          <h2 className="mb-1 mt-4 text-sm font-medium text-text-primary dark:text-text-primary-dark">
            Reminder times
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Morning routine
              <input
                type="number"
                min={0}
                max={23}
                value={reminderMorningRoutineHour}
                onChange={(e) => setReminderMorningRoutineHour(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="8"
                aria-label="Morning routine reminder hour"
                className="ml-2 w-16 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
              <span className="ml-1">:00</span>
            </label>
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Evening routine
              <input
                type="number"
                min={0}
                max={23}
                value={reminderEveningRoutineHour}
                onChange={(e) => setReminderEveningRoutineHour(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="20"
                aria-label="Evening routine reminder hour"
                className="ml-2 w-16 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
              <span className="ml-1">:00</span>
            </label>
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Reflection
              <input
                type="number"
                min={0}
                max={23}
                value={reminderReflectionHour}
                onChange={(e) => setReminderReflectionHour(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="21"
                aria-label="Reflection reminder hour"
                className="ml-2 w-16 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
              <span className="ml-1">:00</span>
            </label>
          </div>
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            24-hour clock (e.g. 8 for 8am, 20 for 8pm) — each reminder can fire anytime in the 30 minutes after its
            hour. Leave blank to use the default (8am morning routine, 8pm evening routine, 9pm reflection).
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Habit reminder from
              <input
                type="number"
                min={1}
                max={180}
                value={reminderHabitMinOverdueMinutes}
                onChange={(e) => setReminderHabitMinOverdueMinutes(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="15"
                aria-label="Habit reminder minimum overdue minutes"
                className="ml-2 w-16 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
              <span className="ml-1">min</span>
            </label>
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              to
              <input
                type="number"
                min={5}
                max={480}
                value={reminderHabitMaxOverdueMinutes}
                onChange={(e) => setReminderHabitMaxOverdueMinutes(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="120"
                aria-label="Habit reminder maximum overdue minutes"
                className="ml-2 w-16 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
              <span className="ml-1">min overdue</span>
            </label>
          </div>
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            How overdue a due habit needs to be before a reminder fires for it. Leave both blank to use the default
            (15–120 minutes).
          </p>

          {/* Configurable daily reflection questions increment — renames
              what's *displayed* for each of the three fixed daily
              reflection questions on /reflection. Doesn't add a fourth
              question or change what's stored on a submitted reflection
              (still always wentWell/challenging/carryForward) — the AI
              summary prompt and Insights both assume exactly these three
              keys, so that stays fixed regardless of wording. */}
          <h2 className="mb-1 mt-4 text-sm font-medium text-text-primary dark:text-text-primary-dark">
            Daily reflection questions
          </h2>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Went well
              <input
                type="text"
                value={reflectionWentWellLabel}
                onChange={(e) => setReflectionWentWellLabel(e.target.value)}
                maxLength={150}
                placeholder="What went well today?"
                aria-label="Went well question label"
                className="mt-1 block w-full rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
            </label>
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Challenging
              <input
                type="text"
                value={reflectionChallengingLabel}
                onChange={(e) => setReflectionChallengingLabel(e.target.value)}
                maxLength={150}
                placeholder="What was challenging?"
                aria-label="Challenging question label"
                className="mt-1 block w-full rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
            </label>
            <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Carry forward
              <input
                type="text"
                value={reflectionCarryForwardLabel}
                onChange={(e) => setReflectionCarryForwardLabel(e.target.value)}
                maxLength={150}
                placeholder="What do you want to carry into tomorrow?"
                aria-label="Carry forward question label"
                className="mt-1 block w-full rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
              />
            </label>
          </div>
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            Shown on the Reflection screen each evening. Leave any of these blank to use the default wording.
          </p>

          {error && (
            <p className="mt-3 text-xs text-danger dark:text-danger-dark" role="alert">
              {error}
            </p>
          )}

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            {/* Screen-reader pass: was a plain, non-live span — see the
                Notifications page's identical fix for the same reasoning. */}
            {saved && !saving && (
              <span role="status" className="text-xs text-text-secondary dark:text-text-secondary-dark">
                Saved.
              </span>
            )}
          </div>

          {/* Re-enter onboarding increment: the quiz page itself has
              always been reachable by typing /onboarding directly
              (OnboardingGate exempts that path), but nothing anywhere
              linked to it — this closes that discoverability gap.
              Chronotype/work hours/quiet hours pre-fill from your existing
              answers there; the "biggest source of overload" question
              deliberately doesn't (see onboarding/page.tsx's own note on
              why that one specifically isn't pre-filled).
              Resumable onboarding wizard increment: ?redo=quiz is what
              tells the onboarding page "show the quiz for editing," taking
              priority over the new default of resuming wherever the wizard
              was last left off — without it, this link would now land back
              on the calendar or First-plan step instead of the quiz, since
              onboardingCompletedAt is already true for anyone who can see
              this page at all. */}
          <Link
            href="/onboarding?redo=quiz"
            className="mt-4 block text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark"
          >
            Redo the onboarding quiz →
          </Link>
        </div>
      )}

      {/* Broader account settings increment: email + plan, both read-only
          here. Email comes straight from the auth provider (Clerk, or the
          dev-auth header) — there's no editable email field anywhere in
          this app, so this is display-only, same as Subscription itself.
          `subscription` has existed on User since the very first profile
          increment (a real Free-tier row created for every account at
          signup — see UsersService.getOrCreateFromAuth) but was never once
          shown anywhere in the UI until now. */}
      {initialized && data?.me && (
        <div className="mx-4 mb-4 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
          <h2 className="mb-2 text-sm font-medium text-text-primary dark:text-text-primary-dark">Account</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary dark:text-text-secondary-dark">Email</dt>
              <dd className="text-text-primary dark:text-text-primary-dark">{data.me.email}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary dark:text-text-secondary-dark">Status</dt>
              <dd className="text-text-primary dark:text-text-primary-dark">
                {STATUS_LABELS[data.me.subscription?.status] ?? data.me.subscription?.status}
              </dd>
            </div>
            {data.me.subscription?.currentPeriodEnd && (
              <div className="flex justify-between gap-3">
                <dt className="text-text-secondary dark:text-text-secondary-dark">Renews</dt>
                <dd className="text-text-primary dark:text-text-primary-dark">
                  {formatRenewalDate(data.me.subscription.currentPeriodEnd)}
                </dd>
              </div>
            )}
          </dl>

          {/* Editable email increment: changing a login email needs real
              verification (a confirmation code, re-auth) that this app has
              no way to do on its own — Clerk already does this correctly in
              its own hosted account modal, so this opens that instead of
              rebuilding it. AUTH_MODE=dev has no real identity provider at
              all (the email is just the x-dev-user-email header, fixed by
              an env var) — explanatory text only there, no button that
              would do nothing. */}
          {isDevAuth ? (
            <p className="mt-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              Email is fixed to <code>NEXT_PUBLIC_DEV_USER_EMAIL</code> in dev-auth mode — there's no real identity
              provider here to change it through.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => openClerkUserProfile()}
              className="mt-2 text-xs text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark"
            >
              Change email →
            </button>
          )}

          {/* Real Stripe billing integration: Plus/Pro really start a real
              Stripe Checkout session when the server has real Stripe keys
              configured (see billing/stripe.service.ts) — redirecting to
              Stripe's own hosted, PCI-scope-free payment page, no card
              form built here. Once a real Stripe customer exists, these
              buttons go read-only and "Manage billing" (Stripe's own
              hosted Billing Portal) takes over for upgrades/downgrades/
              cancellation — see handleTierClick's own comment for why. If
              the server has no Stripe keys at all, this falls back to the
              original simulated instant-switch behavior, same honest
              "real change, not a real charge" reasoning
              UsersService.changeSubscriptionTier's own comment describes. */}
          <h3 className="mb-1 mt-3 text-xs font-medium text-text-primary dark:text-text-primary-dark">Plan</h3>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Choose your plan">
            {TIER_OPTIONS.map((option) => {
              const isCurrent = data.me.subscription?.tier === option.value;
              const hasStripeCustomer = !!data.me.subscription?.hasStripeCustomer;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={changingTier || checkingOut || isCurrent || hasStripeCustomer}
                  aria-pressed={isCurrent}
                  onClick={() => handleTierClick(option.value, hasStripeCustomer)}
                  className={
                    // "Current" pill: plain `bg-accent text-white`, unconditional
                    // (no `dark:bg-accent-dark` override) — the same solid-fill
                    // pairing every other CTA button in this app already uses
                    // (Save settings, Add, Accept plan, ...), verified at 5.55:1
                    // in both light and dark mode specifically *because* it
                    // never swaps to the dark-mode accent value; white text on
                    // `accent-dark` only clears 3.93:1, under the 4.5:1 AA
                    // minimum for text this size — computed while building
                    // this, not assumed, since a first draft of this exact
                    // button (a translucent `bg-accent/10` tint) measured well
                    // under AA in dark mode too (4.13:1) before being replaced
                    // with this pairing.
                    isCurrent
                      ? 'rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-100'
                      : 'rounded-control border border-border px-3 py-1.5 text-xs text-text-secondary hover:border-accent hover:text-accent dark:border-border-dark dark:text-text-secondary-dark dark:hover:border-accent-dark dark:hover:text-accent-dark disabled:opacity-50'
                  }
                >
                  {option.label} · {option.price}
                  {isCurrent ? ' (current)' : ''}
                </button>
              );
            })}
          </div>
          {data.me.subscription?.hasStripeCustomer && (
            <button
              type="button"
              disabled={openingPortal}
              onClick={handleManageBilling}
              className="mt-2 text-xs font-medium text-accent dark:text-accent-dark disabled:opacity-50"
            >
              {openingPortal ? 'Opening…' : 'Manage billing →'}
            </button>
          )}
          {tierError && (
            <p className="mt-2 text-xs text-danger dark:text-danger-dark" role="alert">
              {tierError}
            </p>
          )}
          {!data.me.subscription?.hasStripeCustomer && (
            <p className="mt-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              Choosing Plus or Pro starts a real Stripe Checkout if this server has Stripe configured. If it
              doesn&apos;t, switching here is simulated instead — no real payment is processed and no card details
              are collected.
            </p>
          )}
        </div>
      )}

      {/* Account deletion increment. A separate card, visually set apart
          (danger-colored border) from everything above it, following the
          common "danger zone" convention for a destructive account action —
          nothing else on this page can lose data the way this can. */}
      {initialized && (
        <div className="mx-4 mb-4 rounded-card border border-danger dark:border-danger-dark bg-surface dark:bg-surface-dark p-4">
          <h2 className="mb-1 text-sm font-medium text-danger dark:text-danger-dark">Danger zone</h2>
          <p className="mb-3 text-xs text-text-secondary dark:text-text-secondary-dark">
            Deleting your account permanently removes your tasks, goals, habits, calendar events, journal entries,
            check-ins, focus sessions, routines, reflections, AI conversations, and AI memory. This can't be undone.
          </p>
          <label htmlFor="delete-confirm-input" className="mb-1 block text-xs text-text-secondary dark:text-text-secondary-dark">
            Type DELETE to confirm
          </label>
          <input
            id="delete-confirm-input"
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            className="w-full rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-danger"
          />

          {deleteError && (
            <p className="mt-3 text-xs text-danger dark:text-danger-dark" role="alert">
              {deleteError}
            </p>
          )}

          <button
            onClick={handleDeleteAccount}
            disabled={deleteConfirmText !== 'DELETE' || deleting}
            className="mt-3 rounded-control bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      )}

      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
