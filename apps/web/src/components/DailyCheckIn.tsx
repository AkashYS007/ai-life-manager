'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { LOG_MOOD, LOG_ENERGY, LOG_SLEEP, TODAY_PLAN_QUERY } from '../lib/queries';

const SCORES = [1, 2, 3, 4, 5];
const MOOD_EMOJI = ['😞', '🙁', '😐', '🙂', '😄'];
const ENERGY_EMOJI = ['🪫', '🔋', '🔋', '⚡', '⚡'];

function ScorePicker({
  emoji,
  selected,
  onPick,
  disabled,
  label,
}: {
  emoji: string[];
  selected?: number;
  onPick: (score: number) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-text-secondary dark:text-text-secondary-dark">{label}</span>
      {/* Screen-reader pass: `aria-pressed` on each button reports which
          score is currently the latest logged one — a real gap before this,
          since the ring/fill highlight was visual-only. Kept as five
          independent toggle buttons (role="group", not role="radiogroup")
          rather than a full ARIA radio-group pattern, since that would also
          require roving-tabindex arrow-key navigation this component
          doesn't implement; `aria-pressed` doesn't carry that expectation. */}
      <div className="flex gap-1.5" role="group" aria-label={label}>
        {SCORES.map((score) => (
          <button
            key={score}
            type="button"
            aria-label={`${label} ${score} out of 5`}
            aria-pressed={selected === score}
            disabled={disabled}
            onClick={() => onPick(score)}
            className={`flex h-8 w-8 items-center justify-center rounded-full text-base transition-standard disabled:opacity-50 ${
              selected === score
                ? 'bg-accent/20 ring-2 ring-accent dark:bg-accent-dark/20 dark:ring-accent-dark'
                : 'bg-background hover:bg-surface dark:bg-background-dark'
            }`}
          >
            {emoji[score - 1]}
          </button>
        ))}
      </div>
    </div>
  );
}

// The "state (energy/mood)" half of the Today screen's personal-dashboard
// promise (PRD §7.1) — a 2-tap check-in (PRD §7.2), not a form. Mood/energy
// are logged as a new entry per tap (you can check in more than once a
// day); sleep is a single correctable entry for last night, so re-logging
// just updates it in place (matches logSleep's upsert-by-date behavior).
export function DailyCheckIn({
  todayMood,
  todayEnergy,
  lastNightSleep,
}: {
  todayMood?: { moodScore: number } | null;
  todayEnergy?: { energyScore: number } | null;
  lastNightSleep?: { durationMinutes?: number; qualityScore?: number } | null;
}) {
  const [sleepHours, setSleepHours] = useState(
    lastNightSleep?.durationMinutes ? String(Math.round((lastNightSleep.durationMinutes / 60) * 10) / 10) : '',
  );
  const [sleepQuality, setSleepQuality] = useState<number | undefined>(lastNightSleep?.qualityScore);

  const refetchQueries = [{ query: TODAY_PLAN_QUERY }];
  const [logMood, { loading: loggingMood }] = useMutation(LOG_MOOD, { refetchQueries });
  const [logEnergy, { loading: loggingEnergy }] = useMutation(LOG_ENERGY, { refetchQueries });
  const [logSleep, { loading: loggingSleep }] = useMutation(LOG_SLEEP, { refetchQueries });

  function handleLogSleep() {
    const hours = parseFloat(sleepHours);
    logSleep({
      variables: {
        durationMinutes: Number.isFinite(hours) ? Math.round(hours * 60) : undefined,
        qualityScore: sleepQuality,
      },
    });
  }

  return (
    <div className="mx-4 mb-3 flex flex-col gap-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-4">
      <ScorePicker
        label="Mood"
        emoji={MOOD_EMOJI}
        selected={todayMood?.moodScore}
        disabled={loggingMood}
        onPick={(moodScore) => logMood({ variables: { moodScore } })}
      />
      <ScorePicker
        label="Energy"
        emoji={ENERGY_EMOJI}
        selected={todayEnergy?.energyScore}
        disabled={loggingEnergy}
        onPick={(energyScore) => logEnergy({ variables: { energyScore } })}
      />

      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs text-text-secondary dark:text-text-secondary-dark">Sleep</span>
        <input
          type="number"
          step="0.5"
          min="0"
          placeholder="Hours"
          aria-label="Hours of sleep last night"
          value={sleepHours}
          onChange={(e) => setSleepHours(e.target.value)}
          disabled={loggingSleep}
          className="w-20 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1.5 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="flex gap-1" role="group" aria-label="Sleep quality">
          {SCORES.map((score) => (
            <button
              key={score}
              type="button"
              aria-label={`Sleep quality ${score} out of 5`}
              aria-pressed={sleepQuality === score}
              disabled={loggingSleep}
              onClick={() => setSleepQuality(score)}
              className={`h-6 w-6 rounded-full text-xs transition-standard disabled:opacity-50 ${
                sleepQuality === score
                  ? 'bg-accent text-white'
                  : 'bg-background text-text-secondary hover:bg-surface dark:bg-background-dark'
              }`}
            >
              {score}
            </button>
          ))}
        </div>
        <button
          disabled={loggingSleep || !sleepHours}
          onClick={handleLogSleep}
          className="ml-auto rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {lastNightSleep ? 'Update' : 'Log'}
        </button>
      </div>
    </div>
  );
}
