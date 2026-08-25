'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  COMPLETE_ONBOARDING,
  REQUEST_REPLAN,
  TODAY_PLAN_QUERY,
  ME_ONBOARDING_QUERY,
  ONBOARDING_PREFILL_QUERY,
  RECORD_ONBOARDING_WIZARD_STEP,
} from '../../lib/queries';
import { GoogleCalendarConnect } from '../../components/GoogleCalendarConnect';
import { MicrosoftCalendarConnect } from '../../components/MicrosoftCalendarConnect';
import { AppleCalendarConnect } from '../../components/AppleCalendarConnect';

type Step = 'welcome' | 'quiz' | 'calendar' | 'plan';

// A single "large single-choice card" (UI/UX Design Document §10 step 3:
// diagnostic quiz questions "rendered as large single-choice cards, not a
// form — feels more like a quick quiz than paperwork"), reused for every
// question below.
function ChoiceCard({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-control border px-3 py-2 text-left text-sm ${
        selected
          ? 'border-accent bg-accent/10 font-medium text-accent dark:border-accent-dark dark:bg-accent-dark/10 dark:text-accent-dark'
          : 'border-border text-text-primary dark:border-border-dark dark:text-text-primary-dark'
      }`}
    >
      {label}
    </button>
  );
}

function QuizQuestion({ prompt, children }: { prompt: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-sm font-medium text-text-primary dark:text-text-primary-dark">{prompt}</p>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

const CHRONOTYPE_OPTIONS: Array<{ label: string; value: 'EARLY_BIRD' | 'NIGHT_OWL' | 'NEUTRAL' }> = [
  { label: 'Morning person', value: 'EARLY_BIRD' },
  { label: 'Night owl', value: 'NIGHT_OWL' },
  { label: 'Neither, really', value: 'NEUTRAL' },
];

// Free time picker for quiz's work/quiet hours increment: replaces the
// five/three preset-card options (06:00-10:00, 16:00-20:00, and two fixed
// quiet-hours ranges) that used to live here — work starting at 6:30, or
// quiet hours from 9:30pm, simply weren't selectable before. Same real
// `<input type="time">` pattern Settings' own "Work hours" section and
// Notifications' own "Quiet hours" section already use elsewhere in this
// app (see settings/page.tsx and notifications/page.tsx) — this closes the
// one place left that still forced a preset pick for the same two answers.

// Free-text "biggest source of overload" increment: replaces the five
// fixed preset cards that used to live here (Work & career, Health &
// fitness, Family & relationships, Just staying organized, Something else
// entirely) with a real text input — the same "no backend change needed"
// discovery as the Free time picker increment above: CompleteOnboardingInput
// .overloadSource already accepted any string up to 200 characters
// (@Length(1, 200)), never an enum of presets. This was the diagnostic
// quiz's last remaining fixed-preset question — see the free-text notes
// field a little further down, and the free time picker above it, for the
// two gaps this closes the last of.

// The diagnostic onboarding increment's full flow (UI/UX Design Document
// §5, §10): Welcome → Diagnostic quiz → Connect calendar → First plan.
// "Sign up" (step 2 in that doc) isn't a step here — it's the existing
// Clerk-hosted /sign-up route a person already went through to have a
// session at all by the time OnboardingGate ever redirects them here.
//
// Fix onboarding calendar-connect redirect increment: the default export
// below is now just a thin Suspense wrapper around the real page —
// `OnboardingPageInner` needs `useSearchParams()` itself now (to detect
// "we just landed back here from a Google/Microsoft OAuth redirect", not
// just the child connect components' own already-Suspense-wrapped reads of
// the same params), and Next.js requires a Suspense boundary above any
// component that calls it or `next build` fails.
export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingPageInner />
    </Suspense>
  );
}

function OnboardingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Fix onboarding calendar-connect redirect increment: true only for the
  // one page load that lands here straight off a Google/Microsoft OAuth
  // callback (`?googleConnect=...`/`?microsoftConnect=...` — see
  // GoogleCalendarConnect.tsx/MicrosoftCalendarConnect.tsx's own read of
  // these same two params). Computed once via useState's lazy initializer,
  // not on every render, since `step` moving away from 'calendar'
  // afterward (Continue to First plan, say) shouldn't un-set this.
  const [returningFromCalendarConnect] = useState(
    () => searchParams.get('googleConnect') !== null || searchParams.get('microsoftConnect') !== null,
  );
  // Resumable onboarding wizard increment: true only when Settings' own
  // "Redo the onboarding quiz →" link was the thing that sent someone here
  // — see that link's own comment for why it needs this. Takes priority
  // over resuming wherever the wizard was last left off (below), but not
  // over returningFromCalendarConnect above — a person can't be doing both
  // at once (the OAuth redirect never sets `redo`), so there's no real
  // conflict between the two, just a fixed precedence order.
  const [redoRequested] = useState(() => searchParams.get('redo') === 'quiz');
  const [step, setStep] = useState<Step>(returningFromCalendarConnect ? 'calendar' : 'welcome');

  // Screen-reader pass: this whole wizard swaps its visible content on
  // every step change without ever moving focus or announcing anything —
  // a screen-reader user got no signal a new step even appeared, unless
  // they happened to keep tabbing forward into it. Each step's own <h1>
  // below shares this one ref (only one is ever mounted at a time) and
  // gets focus whenever `step` changes, the same "land on the new
  // section's heading" pattern a full page navigation gives for free.
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);

  const [chronotype, setChronotype] = useState<'EARLY_BIRD' | 'NIGHT_OWL' | 'NEUTRAL' | null>(null);
  // Free time picker for quiz's work/quiet hours increment: plain "HH:mm"
  // strings (or '' for unset) straight from a real <input type="time">, the
  // same shape/blank-means-unset convention Settings' Work hours and
  // Notifications' Quiet hours sections already use — no more matching
  // against a fixed preset list.
  const [workHoursStart, setWorkHoursStart] = useState('');
  const [workHoursEnd, setWorkHoursEnd] = useState('');
  const [quietHoursStart, setQuietHoursStart] = useState('');
  const [quietHoursEnd, setQuietHoursEnd] = useState('');
  // Free-text "biggest source of overload" increment: plain string, ''
  // meaning unanswered — same shape/convention as freeTextNotes just below
  // and workHoursStart/etc. above, no longer matched against a fixed list
  // of preset option strings.
  const [overloadSource, setOverloadSource] = useState('');
  // Diagnostic quiz free-text answers increment: the quiz's first genuinely
  // open-ended question — every question above this one is a fixed preset
  // pick from a card, never typed text.
  const [freeTextNotes, setFreeTextNotes] = useState('');

  // Re-enter onboarding increment. A returning visitor (onboardingCompletedAt
  // already set) skips the "Your AI Chief of Staff..." pitch and lands
  // straight on the quiz, with chronotype/work hours/quiet hours pre-filled
  // from whatever's already saved — editing existing answers, not
  // re-answering blind. Free time picker for quiz's work/quiet hours
  // increment: work/quiet hours now pre-fill their raw saved "HH:mm" values
  // directly into the real time inputs, no more matching against a fixed
  // preset list to find which one (if any) the saved values happened to
  // equal — a real, more accurate prefill than before, since a saved value
  // that never matched a preset (impossible before this increment, since
  // presets were the only way to set one) now just displays correctly.
  // Deliberately doesn't pre-fill "biggest source of
  // overload": that answer is stored as a full sentence on a plain AI
  // Memory fact (see MemoryService.upsertOnboardingOverloadFact), not the
  // raw typed value itself, and `ONBOARDING_PREFILL_QUERY` doesn't
  // currently read AI Memory facts at all, only plain User columns — a
  // known, deliberate gap, not an oversight (extracting the original text
  // back out from the stored sentence would be a real, if small, extra
  // query path this increment didn't judge worth adding just for this one
  // field, same call the Diagnostic quiz free-text answers increment
  // already made for its own field, which follows the exact same pattern).
  // Redoing the quiz always starts this one field blank, same as
  // freeTextNotes.
  //
  // Fix onboarding calendar-connect redirect increment: this "already
  // completed onboarding → jump to the quiz step" default is exactly what
  // used to silently swallow a return trip from the calendar step's own
  // OAuth redirect — `onboardingCompletedAt` is stamped the moment the quiz
  // step submits (see the Onboarding completion is all-or-nothing bullet in
  // the README's "what's not built yet"), so it's already true by the time
  // anyone reaches the calendar step at all, redirect or not. The
  // `!returningFromCalendarConnect` guard below is what lets the lazy
  // `useState` initializer above actually stick on first render instead of
  // being immediately overwritten back to 'quiz' here.
  //
  // Resumable onboarding wizard increment: this used to unconditionally
  // jump to 'quiz' the moment `onboardingCompletedAt` was true — the exact
  // gap this increment closes. `redoRequested` (Settings' own explicit
  // "Redo the onboarding quiz →" link) still wins outright, same as it
  // always effectively did. Otherwise, `me.onboardingWizardStep` — real,
  // server-tracked progress (see OnboardingService.recordWizardStep) —
  // decides where to resume: 'PLAN' means the calendar step's own Continue
  // was already clicked, so land back on First plan; anything else (the
  // literal 'CALENDAR' value, or `null` for every account that finished
  // onboarding before this migration ran and therefore never got a chance
  // to write it) resumes at the calendar step — the same step
  // `completeOnboarding` itself always leads to next, so it's a safe
  // default even for those pre-migration accounts, not just a guess.
  const [prefillApplied, setPrefillApplied] = useState(false);
  const { data: prefillData } = useQuery(ONBOARDING_PREFILL_QUERY);

  if (!prefillApplied && prefillData?.me) {
    const me = prefillData.me;
    if (me.onboardingCompletedAt && !returningFromCalendarConnect) {
      if (redoRequested) {
        setStep('quiz');
      } else if (me.onboardingWizardStep === 'PLAN') {
        setStep('plan');
      } else {
        setStep('calendar');
      }
    }
    if (me.chronotype) setChronotype(me.chronotype);
    if (me.workHoursStart) setWorkHoursStart(me.workHoursStart);
    if (me.workHoursEnd) setWorkHoursEnd(me.workHoursEnd);
    if (me.quietHoursStart) setQuietHoursStart(me.quietHoursStart);
    if (me.quietHoursEnd) setQuietHoursEnd(me.quietHoursEnd);
    setPrefillApplied(true);
  }

  const [completeOnboarding, { loading: submittingQuiz }] = useMutation(COMPLETE_ONBOARDING, {
    // Every page's post-onboarding first load reads onboardingCompletedAt
    // via OnboardingGate's own query — refetch it here so the gate doesn't
    // bounce this same person right back the moment they land on /today.
    refetchQueries: [{ query: ME_ONBOARDING_QUERY }],
  });
  const [quizError, setQuizError] = useState<string | null>(null);

  // Resumable onboarding wizard increment — called from the calendar
  // step's own Continue button below, right before moving on to First
  // plan. Best-effort and fire-and-forget on purpose: this is bookkeeping
  // for a future resume, not something the current click should ever wait
  // on or be blocked by — a failed write here just means a later reopen
  // falls back to resuming at the calendar step instead of First plan,
  // never a lost answer or a stuck wizard.
  const [recordWizardStep] = useMutation(RECORD_ONBOARDING_WIZARD_STEP);

  // Fix (frontend audit, 2026-08-25): the payload-level errors[] check was
  // already correct, but a thrown exception (a genuine network failure, not
  // a validation rejection) was never caught — "Saving…" reverted to
  // "Continue" with no error shown and no indication the wizard hadn't
  // advanced.
  async function handleQuizContinue() {
    setQuizError(null);
    try {
      const result = await completeOnboarding({
        variables: {
          input: {
            chronotype: chronotype ?? undefined,
            workHoursStart: workHoursStart || undefined,
            workHoursEnd: workHoursEnd || undefined,
            quietHoursStart: quietHoursStart || undefined,
            quietHoursEnd: quietHoursEnd || undefined,
            overloadSource: overloadSource.trim() || undefined,
            freeTextNotes: freeTextNotes.trim() || undefined,
          },
        },
      });
      const payload = result.data?.completeOnboarding;
      if (payload?.errors?.length) {
        setQuizError(payload.errors[0].message);
        return;
      }
      setStep('calendar');
    } catch {
      setQuizError("Couldn't save that. Try again.");
    }
  }

  return (
    <main id="main-content" className="mx-auto flex min-h-screen max-w-md flex-col justify-center rounded-sheet border border-border dark:border-border-dark bg-surface/40 px-5 py-10 dark:bg-surface-dark/40">
      {step === 'welcome' && (
        <div className="flex flex-col items-center gap-4 text-center">
          <h1
            ref={stepHeadingRef}
            tabIndex={-1}
            className="text-3xl font-semibold text-text-primary dark:text-text-primary-dark focus:outline-none"
          >
            Your AI Chief of Staff, for your whole day.
          </h1>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            A few quick questions, then we&apos;ll build your first real plan.
          </p>
          <button
            onClick={() => setStep('quiz')}
            className="mt-4 rounded-control bg-accent px-6 py-2.5 text-sm font-medium text-white"
          >
            Get started
          </button>
        </div>
      )}

      {step === 'quiz' && (
        <div>
          <h1
            ref={stepHeadingRef}
            tabIndex={-1}
            className="mb-1 text-xl font-medium text-text-primary dark:text-text-primary-dark focus:outline-none"
          >
            A quick baseline
          </h1>
          <p className="mb-5 text-xs text-text-secondary dark:text-text-secondary-dark">
            Every question is optional — skip anything and continue whenever you&apos;re ready.
            {prefillData?.me?.onboardingCompletedAt && ' Your existing answers are pre-filled below — change anything you\'d like.'}
          </p>

          <QuizQuestion prompt="When do you naturally have the most energy?">
            {CHRONOTYPE_OPTIONS.map((o) => (
              <ChoiceCard
                key={o.value}
                label={o.label}
                selected={chronotype === o.value}
                onClick={() => setChronotype(o.value)}
              />
            ))}
          </QuizQuestion>

          <QuizQuestion prompt="What are your usual work hours?">
            <div className="col-span-2">
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
                Leave both blank to use the default (7am–9pm).
              </p>
            </div>
          </QuizQuestion>

          <QuizQuestion prompt="When should we stay quiet — no notifications?">
            <div className="col-span-2">
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
                  Quiet hours from
                  <input
                    type="time"
                    value={quietHoursStart}
                    onChange={(e) => setQuietHoursStart(e.target.value)}
                    className="ml-2 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
                  />
                </label>
                <label className="text-xs text-text-secondary dark:text-text-secondary-dark">
                  to
                  <input
                    type="time"
                    value={quietHoursEnd}
                    onChange={(e) => setQuietHoursEnd(e.target.value)}
                    className="ml-2 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark"
                  />
                </label>
              </div>
              <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
                Notifications that would arrive during quiet hours wait until they end. Leave both blank for no quiet hours.
              </p>
            </div>
          </QuizQuestion>

          {/* Free-text "biggest source of overload" increment: a real text
              input, not a set of preset cards — the AI reads this verbatim
              (see MemoryService.upsertOnboardingOverloadFact), the same
              "shows up in chat/planning right away" wiring the free-text
              notes question below already has. */}
          <QuizQuestion prompt="What's your biggest source of overload right now?">
            <div className="col-span-2">
              <input
                type="text"
                id="onboarding-overload-source"
                aria-label="What's your biggest source of overload right now?"
                value={overloadSource}
                onChange={(e) => setOverloadSource(e.target.value)}
                maxLength={200}
                placeholder="E.g. Work & career, Health & fitness, Family & relationships…"
                className="w-full rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </QuizQuestion>

          {/* Diagnostic quiz free-text answers increment: a real open-ended
              question, not another set of preset cards — the AI reads this
              verbatim (see MemoryService.upsertOnboardingFreeTextFact), so
              anything typed here shows up in chat/planning right away. */}
          <div className="mb-5">
            <label htmlFor="onboarding-free-text" className="mb-2 block text-sm font-medium text-text-primary dark:text-text-primary-dark">
              Anything else the AI should know about you right now? <span className="font-normal text-text-secondary dark:text-text-secondary-dark">(optional)</span>
            </label>
            <textarea
              id="onboarding-free-text"
              value={freeTextNotes}
              onChange={(e) => setFreeTextNotes(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="E.g. I'm training for a marathon, or I have a big deadline this month…"
              className="w-full rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {quizError && <p className="mb-3 text-xs text-danger dark:text-danger-dark" role="alert">{quizError}</p>}

          <button
            disabled={submittingQuiz}
            onClick={handleQuizContinue}
            className="w-full rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {submittingQuiz ? 'Saving…' : 'Continue'}
          </button>
        </div>
      )}

      {step === 'calendar' && (
        <div>
          <h1
            ref={stepHeadingRef}
            tabIndex={-1}
            className="mb-1 text-xl font-medium text-text-primary dark:text-text-primary-dark focus:outline-none"
          >
            Connect your calendar
          </h1>
          <p className="mb-5 text-xs text-text-secondary dark:text-text-secondary-dark">
            So the AI plans around what&apos;s already on your schedule. You can always do this later.
          </p>

          {/* useSearchParams (to read ?googleConnect=.../?microsoftConnect=...
              after each OAuth redirect) requires a Suspense boundary — same
              reasoning/precedent as the /calendar page's identical wrapping.
              Fix onboarding calendar-connect redirect increment:
              returnTo="onboarding" here (and nowhere else — /calendar's own
              usage of these two components deliberately doesn't pass it) is
              what makes the OAuth callback controllers send the browser
              back to /onboarding instead of always /calendar. */}
          <Suspense fallback={null}>
            <GoogleCalendarConnect refetchQueries={[{ query: TODAY_PLAN_QUERY }]} returnTo="onboarding" />
          </Suspense>
          <Suspense fallback={null}>
            <MicrosoftCalendarConnect refetchQueries={[{ query: TODAY_PLAN_QUERY }]} returnTo="onboarding" />
          </Suspense>
          {/* No useSearchParams here (Apple's connect flow is a plain form
              submission, not an OAuth redirect) — no Suspense boundary needed. */}
          <AppleCalendarConnect refetchQueries={[{ query: TODAY_PLAN_QUERY }]} />

          <button
            onClick={() => {
              // Resumable onboarding wizard increment: fire-and-forget, not
              // awaited — see the mutation's own comment above for why a
              // failed write here should never delay or block moving on.
              recordWizardStep({ variables: { step: 'PLAN' } }).catch(() => {});
              setStep('plan');
            }}
            className="mt-2 w-full rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-white"
          >
            Continue
          </button>
        </div>
      )}

      {step === 'plan' && <FirstPlanStep onDone={() => router.replace('/today')} />}
    </main>
  );
}

// Step 5: "the app immediately generates a real AiPlanRun from whatever
// calendar/task data exists (even if sparse) and presents it... as the
// first thing the user sees post-setup — the aha moment happens inside
// onboarding, not after it" (UI/UX Design Document §10). A brand-new
// account very often has zero tasks yet, so NOTHING_TO_PLAN is the common
// case here, not an edge case — handled as an honest, encouraging empty
// state rather than an error, same "nothing here yet" discipline as every
// other empty state in this app.
function FirstPlanStep({ onDone }: { onDone: () => void }) {
  const [requestReplan, { data, loading, called }] = useMutation(REQUEST_REPLAN, {
    refetchQueries: [{ query: TODAY_PLAN_QUERY }],
  });

  // Screen-reader pass: this component only ever mounts once, exactly when
  // OnboardingPage's own step becomes 'plan' — so a plain on-mount focus
  // (not a `step`-watching effect, since there's no `step` prop here) gives
  // the same "land on the new step's heading" behavior as the other three
  // steps in the parent component above.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const payload = data?.requestReplan;
  const errorCode = payload?.errors?.[0]?.code;
  const planRun = payload?.planRun;

  // Fires once on mount, not during render (the mutation call itself is a
  // side effect and must not run inline in the render body) — `called`
  // guards against Strict Mode's intentional double-invoke in dev firing
  // this twice.
  useEffect(() => {
    if (!called) {
      requestReplan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [called]);

  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mb-1 text-xl font-medium text-text-primary dark:text-text-primary-dark focus:outline-none"
      >
        Your first plan
      </h1>

      {loading && (
        <p className="mb-5 text-sm text-text-secondary dark:text-text-secondary-dark">Thinking through your day…</p>
      )}

      {!loading && errorCode === 'NOTHING_TO_PLAN' && (
        <p className="mb-5 text-sm text-text-secondary dark:text-text-secondary-dark">
          You don&apos;t have any open tasks yet — add a couple on Today and the AI will build a real plan around
          them.
        </p>
      )}

      {!loading && errorCode === 'AI_NOT_CONFIGURED' && (
        <p className="mb-5 text-sm text-text-secondary dark:text-text-secondary-dark">
          AI planning isn&apos;t turned on for this server yet — everything else is ready to go.
        </p>
      )}

      {!loading && errorCode && errorCode !== 'NOTHING_TO_PLAN' && errorCode !== 'AI_NOT_CONFIGURED' && (
        <p className="mb-5 text-sm text-danger dark:text-danger-dark" role="alert">Couldn&apos;t generate a plan right now — you can try again from Today.</p>
      )}

      {!loading && planRun && (
        <div className="mb-5 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
          <p className="text-sm text-text-primary dark:text-text-primary-dark">{planRun.diff.summary}</p>
        </div>
      )}

      <button
        onClick={onDone}
        className="w-full rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-white"
      >
        Go to Today →
      </button>
    </div>
  );
}
