'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@apollo/client';
import {
  ACTIVE_FOCUS_SESSION_QUERY,
  RECENT_FOCUS_SESSIONS_QUERY,
  START_FOCUS_SESSION,
  COMPLETE_FOCUS_SESSION,
  CANCEL_FOCUS_SESSION,
  TODAY_PLAN_QUERY,
  POMODORO_SETTINGS_QUERY,
} from '../../lib/queries';
import { BottomNav } from '../../components/BottomNav';

const DURATION_PRESETS = [25, 5, 50];

// Automatic Pomodoro work/break cycling increment: the classic Pomodoro
// Technique cadence — 25-minute work blocks, a 5-minute break after each,
// and a longer 15-minute break every 4th work block. Configurable Pomodoro
// durations increment: these are now just the fallback defaults, used when
// a person's User row has never set the matching pomodoro* column (i.e.
// still `null`) — the actual in-use values are read per-user in
// FocusPageContent below via POMODORO_SETTINGS_QUERY and fall back to these.
const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_SHORT_BREAK_MINUTES = 5;
const DEFAULT_LONG_BREAK_MINUTES = 15;
const DEFAULT_CYCLES_BEFORE_LONG_BREAK = 4;

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function relativeSessionLabel(startedAt: string): string {
  const started = new Date(startedAt);
  const now = new Date();
  const time = started.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const startOfStarted = new Date(started.getFullYear(), started.getMonth(), started.getDate());
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfStarted.getTime()) / (24 * 60 * 60 * 1000));
  if (dayDiff <= 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Yesterday at ${time}`;
  return started.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Best-effort only — never requests permission itself (that has to happen
// from an explicit user gesture, and PushSubscribeButton elsewhere already
// owns that flow). If permission was never granted, this silently does
// nothing; the on-screen transition banner in FocusPageContent below is the
// one transition signal that always works regardless of notification
// permission.
function notifyTransition(title: string, body: string) {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch {
    // Some browsers (notably iOS Safari PWAs) throw on `new Notification`
    // even when permission reads 'granted' — never let a cosmetic signal
    // break the actual cycling logic around it.
  }
}

// Countdown ring for an in-progress session. Deliberately recomputes
// remaining time from startedAt + plannedDurationMinutes on a 1-second
// client-side tick rather than polling the server every second — the
// server's start time is the only source of truth needed to resume this
// correctly after a page reload (see FocusService.getActive), a local
// interval just re-renders the same math.
function ActiveSessionView({
  session,
  onComplete,
  onCancel,
  ending,
  autoAdvanceEnabled,
  onAutoAdvance,
  cycleLabel,
  longBreakMinutes,
}: {
  session: { id: string; kind: string; taskTitle?: string | null; plannedDurationMinutes: number; startedAt: string };
  onComplete: () => void;
  onCancel: () => void;
  ending: boolean;
  autoAdvanceEnabled: boolean;
  onAutoAdvance: () => void;
  cycleLabel?: string;
  longBreakMinutes: number;
}) {
  const [, setTick] = useState(0);
  const firedAutoAdvanceRef = useRef(false);

  useEffect(() => {
    // A fresh session id means a fresh countdown — the auto-advance guard
    // has to reset alongside it, or the very first tick of the *next*
    // session (already at 0 remaining seconds for an instant) could
    // re-trigger advancing a second time.
    firedAutoAdvanceRef.current = false;
  }, [session.id]);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsedSeconds = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);
  const totalSeconds = session.plannedDurationMinutes * 60;
  const remainingSeconds = totalSeconds - elapsedSeconds;
  const isOvertime = remainingSeconds <= 0;
  const isBreak = session.kind === 'BREAK';

  useEffect(() => {
    if (isOvertime && autoAdvanceEnabled && !firedAutoAdvanceRef.current) {
      firedAutoAdvanceRef.current = true;
      onAutoAdvance();
    }
  }, [isOvertime, autoAdvanceEnabled, onAutoAdvance]);

  return (
    <div className="mx-4 mb-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-6 text-center">
      {cycleLabel && (
        <p className="mb-1 text-xs text-text-secondary dark:text-text-secondary-dark">{cycleLabel}</p>
      )}
      {!isBreak && session.taskTitle && (
        <p className="mb-1 text-xs text-text-secondary dark:text-text-secondary-dark">Focusing on</p>
      )}
      <h2 className="mb-4 text-sm font-medium text-text-primary dark:text-text-primary-dark">
        {isBreak
          ? session.plannedDurationMinutes === longBreakMinutes
            ? '☕ Long break'
            : '☕ Break'
          : (session.taskTitle ?? 'Focus session')}
      </h2>
      <p
        className={`mb-1 text-5xl font-semibold tabular-nums ${
          isOvertime ? 'text-ai-accent dark:text-ai-accent-dark' : 'text-text-primary dark:text-text-primary-dark'
        }`}
      >
        {isOvertime ? formatCountdown(-remainingSeconds) : formatCountdown(remainingSeconds)}
      </p>
      <p className="mb-5 text-xs text-text-secondary dark:text-text-secondary-dark">
        {isOvertime
          ? autoAdvanceEnabled
            ? isBreak
              ? 'Wrapping up your break…'
              : 'Wrapping up this session…'
            : 'Over your planned time — wrap up whenever you\'re ready'
          : `of ${session.plannedDurationMinutes} min planned`}
      </p>
      <div className="flex justify-center gap-3">
        <button
          disabled={ending}
          onClick={onComplete}
          className="rounded-control bg-accent px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isBreak ? 'Skip to next' : 'Complete'}
        </button>
        <button
          disabled={ending}
          onClick={onCancel}
          className="rounded-control border border-border dark:border-border-dark px-5 py-2 text-sm text-text-secondary hover:text-danger dark:hover:text-danger-dark dark:text-text-secondary-dark disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function FocusPageContent() {
  const searchParams = useSearchParams();
  const taskId = searchParams.get('taskId') ?? undefined;
  const taskTitle = searchParams.get('title') ?? undefined;

  const [duration, setDuration] = useState(25);
  const [error, setError] = useState<string | null>(null);

  // Automatic Pomodoro work/break cycling increment: `pomodoroMode` is a
  // client-side-only setting (not persisted server-side), same deliberate
  // scope cut as this session's own countdown math — the *in-progress*
  // session itself still always resumes correctly after a reload (see
  // FocusService.getActive/ActiveSessionView above), but a reload mid-run
  // does reset the automatic chain back off and `cyclesCompleted` back to 0.
  // Worth being upfront about if asked: this is a real, deliberate scope
  // cut, not an oversight — surviving a reload would mean deriving cycle
  // position from server data instead of trusting a client counter, which
  // is a materially bigger change for a feature this app has otherwise kept
  // "simple X first," same pattern as the recurrence/protection increments.
  const [pomodoroMode, setPomodoroMode] = useState(false);
  const [cyclesCompleted, setCyclesCompleted] = useState(0);
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null);
  const [autoAdvancing, setAutoAdvancing] = useState(false);
  // The task a Pomodoro run is focused on is captured once, at the moment
  // the run starts, and reused for every auto-started WORK block after
  // that — so a multi-cycle run's total focused time still all lands on
  // the same task via getCompletedMinutesForTask, rather than only the
  // very first block counting.
  const runTaskIdRef = useRef<string | undefined>(undefined);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    };
  }, []);

  const { data: activeData, loading: activeLoading } = useQuery(ACTIVE_FOCUS_SESSION_QUERY);
  const { data: recentData } = useQuery(RECENT_FOCUS_SESSIONS_QUERY, { variables: { first: 5 } });
  // Configurable Pomodoro durations increment: deliberately network-only,
  // not the default cache-first. The persisted cache (see apollo-client.ts's
  // initCachePersistence — on by design, for offline support) is written to
  // localStorage on a debounce by apollo3-cache-persist, not synchronously
  // on every mutation. A person who saves new durations on /settings and
  // then goes straight to /focus triggers a full navigation that tears down
  // the in-memory cache that mutation just updated and rehydrates whatever
  // was last flushed to localStorage — which can still be the old values if
  // that debounced write hadn't landed yet. cache-first would then treat
  // that stale snapshot as good enough and never re-check the server. This
  // page's own numbers drive real countdown/forced-break behavior, so
  // cache-and-network, not network-only: still paints instantly from
  // whatever's persisted (the whole reason this app persists the cache at
  // all), but always also fires a real request and corrects itself the
  // moment that returns, rather than trusting a snapshot that might already
  // be stale.
  const { data: pomodoroSettingsData } = useQuery(POMODORO_SETTINGS_QUERY, { fetchPolicy: 'cache-and-network' });

  // Configurable Pomodoro durations increment: `null` (never touched
  // Settings) falls back to the classic cadence — the same
  // undefined/null-means-"use the fixed default" convention workHoursStart/
  // End already established, just resolved client-side here instead of on
  // the server, since these numbers are only ever needed for this page's
  // own math and labels.
  const workMinutes = pomodoroSettingsData?.me?.pomodoroWorkMinutes ?? DEFAULT_WORK_MINUTES;
  const shortBreakMinutes = pomodoroSettingsData?.me?.pomodoroShortBreakMinutes ?? DEFAULT_SHORT_BREAK_MINUTES;
  const longBreakMinutes = pomodoroSettingsData?.me?.pomodoroLongBreakMinutes ?? DEFAULT_LONG_BREAK_MINUTES;
  const cyclesBeforeLongBreak = pomodoroSettingsData?.me?.pomodoroCyclesBeforeLongBreak ?? DEFAULT_CYCLES_BEFORE_LONG_BREAK;

  const refetchQueries = [{ query: ACTIVE_FOCUS_SESSION_QUERY }, { query: RECENT_FOCUS_SESSIONS_QUERY, variables: { first: 5 } }];

  const [startSession, { loading: starting }] = useMutation(START_FOCUS_SESSION, { refetchQueries });
  const [completeSession, { loading: completing }] = useMutation(COMPLETE_FOCUS_SESSION, {
    refetchQueries: [...refetchQueries, { query: TODAY_PLAN_QUERY }],
  });
  const [cancelSession, { loading: cancelling }] = useMutation(CANCEL_FOCUS_SESSION, { refetchQueries });

  const activeSession = activeData?.activeFocusSession;

  function showTransition(message: string) {
    setTransitionMessage(message);
    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
    transitionTimeoutRef.current = setTimeout(() => setTransitionMessage(null), 5000);
  }

  async function handleStart() {
    setError(null);
    const startingWork = pomodoroMode ? workMinutes : duration;
    runTaskIdRef.current = taskId;
    const result = await startSession({
      variables: { input: { taskId, plannedDurationMinutes: startingWork, kind: 'WORK' } },
    });
    const errors = result.data?.startFocusSession?.errors ?? [];
    if (errors.length > 0) {
      setError(errors[0].message ?? "Couldn't start a focus session. Try again.");
    }
  }

  // Shared by the manual "Complete"/"Skip to next" button and by the
  // countdown's own auto-fire-at-zero effect in Pomodoro mode — a manual
  // early complete is just as real a "this block is done" signal as the
  // timer reaching zero on its own, so both advance the cycle the same way.
  async function advanceCycle(finishedSession: { id: string; kind: string }) {
    setAutoAdvancing(true);
    try {
      await completeSession({ variables: { id: finishedSession.id } });
      if (!pomodoroMode) return;

      if (finishedSession.kind === 'BREAK') {
        showTransition(`Break's over — starting a ${workMinutes}-minute focus session…`);
        notifyTransition('Break complete', 'Back to work!');
        await startSession({
          variables: { input: { taskId: runTaskIdRef.current, plannedDurationMinutes: workMinutes, kind: 'WORK' } },
        });
      } else {
        const newCycles = cyclesCompleted + 1;
        setCyclesCompleted(newCycles);
        const isLongBreak = newCycles % cyclesBeforeLongBreak === 0;
        const breakMinutes = isLongBreak ? longBreakMinutes : shortBreakMinutes;
        showTransition(`Nice work! Starting a ${breakMinutes}-minute ${isLongBreak ? 'long ' : ''}break…`);
        notifyTransition('Focus session complete', `Starting a ${breakMinutes}-minute break.`);
        await startSession({ variables: { input: { plannedDurationMinutes: breakMinutes, kind: 'BREAK' } } });
      }
    } finally {
      setAutoAdvancing(false);
    }
  }

  async function handleComplete() {
    if (!activeSession) return;
    await advanceCycle(activeSession);
  }

  async function handleCancel() {
    if (!activeSession) return;
    await cancelSession({ variables: { id: activeSession.id } });
    // Cancel always fully exits the automatic chain rather than trying to
    // partially preserve it — the clearest, most predictable behavior, and
    // the easiest to explain live: "Cancel means stop, full stop."
    if (pomodoroMode) {
      setPomodoroMode(false);
      setCyclesCompleted(0);
      setTransitionMessage(null);
    }
  }

  function togglePomodoroMode() {
    setPomodoroMode((current) => {
      const next = !current;
      if (next) {
        setCyclesCompleted(0);
        setDuration(workMinutes);
      }
      return next;
    });
  }

  const recentSessions = recentData?.recentFocusSessions ?? [];

  const cycleLabel =
    pomodoroMode && activeSession
      ? activeSession.kind === 'BREAK'
        ? undefined
        : `Focus block ${cyclesCompleted + 1} · long break after every ${cyclesBeforeLongBreak}`
      : undefined;

  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Focus</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          A simple timer for deep work — start it, stay with it, mark it done.
        </p>
      </div>

      {transitionMessage && (
        <div
          role="status"
          className="mx-4 mb-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark px-4 py-2 text-center text-xs text-text-secondary dark:text-text-secondary-dark"
        >
          {transitionMessage}
        </div>
      )}

      {activeLoading ? (
        <p className="px-5 pb-3 text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>
      ) : activeSession ? (
        <ActiveSessionView
          session={activeSession}
          onComplete={handleComplete}
          onCancel={handleCancel}
          ending={completing || cancelling || autoAdvancing}
          autoAdvanceEnabled={pomodoroMode}
          onAutoAdvance={() => advanceCycle(activeSession)}
          cycleLabel={cycleLabel}
          longBreakMinutes={longBreakMinutes}
        />
      ) : (
        <div className="mx-4 mb-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-5">
          {taskTitle && (
            <p className="mb-3 text-sm text-text-primary dark:text-text-primary-dark">
              Focusing on <span className="font-medium">{taskTitle}</span>
            </p>
          )}

          <label className="mb-1 flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            <input type="checkbox" checked={pomodoroMode} onChange={togglePomodoroMode} />
            <span>
              🍅 Pomodoro mode — {workMinutes} min work · {shortBreakMinutes} min break · {longBreakMinutes} min long
              break every {cyclesBeforeLongBreak}th
            </span>
          </label>
          <a href="/settings" className="mb-4 inline-block text-xs text-accent dark:text-accent-dark hover:underline">
            Customize →
          </a>

          {!pomodoroMode && (
            <>
              <p className="mb-2 text-xs text-text-secondary dark:text-text-secondary-dark">Duration</p>
              <div className="mb-4 flex gap-2">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setDuration(preset)}
                    className={
                      duration === preset
                        ? 'rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white'
                        : 'rounded-control border border-border dark:border-border-dark px-3 py-1.5 text-xs text-text-secondary dark:text-text-secondary-dark'
                    }
                  >
                    {preset} min
                  </button>
                ))}
              </div>
            </>
          )}

          {error && <p className="mb-3 text-xs text-danger dark:text-danger-dark" role="alert">{error}</p>}
          <button
            disabled={starting}
            onClick={handleStart}
            className="w-full rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {starting
              ? 'Starting…'
              : pomodoroMode
                ? `Start Pomodoro (${workMinutes}-minute blocks)`
                : `Start ${duration}-minute focus session`}
          </button>
        </div>
      )}

      {recentSessions.length > 0 && (
        <div className="mx-4 mb-3">
          <p className="mb-2 text-xs text-text-secondary dark:text-text-secondary-dark">Recent sessions</p>
          <div className="flex flex-col gap-2">
            {recentSessions.map((s: any) => (
              <div key={s.id} className="rounded-card bg-surface dark:bg-surface-dark px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-text-primary dark:text-text-primary-dark">
                    {s.kind === 'BREAK' ? (s.plannedDurationMinutes === longBreakMinutes ? 'Long break' : 'Break') : (s.taskTitle ?? 'Focus session')}
                  </p>
                  <span
                    className={
                      s.status === 'COMPLETED'
                        ? 'text-xs text-accent dark:text-accent-dark'
                        : s.status === 'CANCELLED'
                          ? 'text-xs text-text-secondary dark:text-text-secondary-dark'
                          : 'text-xs text-ai-accent dark:text-ai-accent-dark'
                    }
                  >
                    {s.status === 'COMPLETED' ? 'Done' : s.status === 'CANCELLED' ? 'Cancelled' : 'In progress'}
                  </span>
                </div>
                <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                  {relativeSessionLabel(s.startedAt)} · {s.plannedDurationMinutes} min planned
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="h-2" />
      <BottomNav />
    </main>
  );
}

export default function FocusPage() {
  // useSearchParams (to read ?taskId=.../?title=... when arriving from a
  // task's "Focus" button) requires a Suspense boundary, same reasoning as
  // GoogleCalendarConnect/MicrosoftCalendarConnect on the Calendar page.
  return (
    <Suspense fallback={null}>
      <FocusPageContent />
    </Suspense>
  );
}
