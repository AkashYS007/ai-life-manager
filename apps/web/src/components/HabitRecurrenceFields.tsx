'use client';

const DAY_LABELS = [
  { iso: 1, label: 'Mon' },
  { iso: 2, label: 'Tue' },
  { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' },
  { iso: 5, label: 'Fri' },
  { iso: 6, label: 'Sat' },
  { iso: 7, label: 'Sun' },
];

// Full custom habit recurrence increment: full weekday names here, not the
// 3-letter abbreviations DAY_LABELS uses above — these sit inside a select
// rather than next to six other same-width buttons, so there's no space
// pressure forcing the abbreviation, and a full name reads more clearly in
// a dropdown.
const WEEKDAY_OPTIONS = [
  { iso: 1, label: 'Monday' },
  { iso: 2, label: 'Tuesday' },
  { iso: 3, label: 'Wednesday' },
  { iso: 4, label: 'Thursday' },
  { iso: 5, label: 'Friday' },
  { iso: 6, label: 'Saturday' },
  { iso: 7, label: 'Sunday' },
];

// -1 is the same "last" convention rrule.ts's own backend logic uses for
// BYMONTHDAY/BYDAY ordinals — kept identical here so the value sent over
// GraphQL never needs translating at the form boundary.
const ORDINAL_OPTIONS = [
  { value: 1, label: 'first' },
  { value: 2, label: 'second' },
  { value: 3, label: 'third' },
  { value: 4, label: 'fourth' },
  { value: -1, label: 'last' },
];

export interface HabitRecurrenceValue {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  daysOfWeek: number[];
  intervalDays: number;
  intervalWeeks: number;
  monthlyMode: 'DAY_OF_MONTH' | 'NTH_WEEKDAY' | 'DAYS_OF_MONTH' | 'NTH_WEEKDAY_SET';
  dayOfMonth: number;
  lastDayOfMonth: boolean;
  monthlyWeekday: number;
  monthlyOrdinal: number;
  // BYSETPOS / multiple weekdays per month increment. `daysOfMonth` (mode
  // DAYS_OF_MONTH) and `monthlyWeekdaySet` (mode NTH_WEEKDAY_SET, reusing
  // `monthlyOrdinal` above for "which occurrence") are only meaningful in
  // their own mode — the same "present but unused in every other mode"
  // shape every other MONTHLY-only field here already has.
  daysOfMonth: number[];
  monthlyWeekdaySet: number[];
  // Fuller habit recurrence increment: "every N months" — same "always a
  // real number, defaulting to 1" convention intervalDays/intervalWeeks
  // above already use, so a plain monthly habit never has to think about
  // this field at all.
  intervalMonths: number;
  // Orthogonal to every shape above (see rrule.ts's own comment on why
  // COUNT/UNTIL are a shared suffix, not per-shape fields) — `endMode`
  // exists only in this form's local state, not on the wire; the mapping
  // functions in CreateHabitForm/HabitManageRow turn it into `count`/`until`
  // (or neither, for NEVER) at submit time.
  endMode: 'NEVER' | 'COUNT' | 'UNTIL';
  count: number;
  until: string;
}

// Habit-edit UI increment: the six-shape recurrence picker (every day,
// every N days, specific weekdays, every N weeks, monthly by date, monthly
// by weekday) used to live entirely inside CreateHabitForm — this is that
// exact same JSX, extracted so the new habit-edit form can reuse it instead
// of re-implementing rrule shape logic a second time (a real drift risk
// given how many field combinations only apply to specific
// frequency/mode pairs — see rrule.ts's own comment on the six shapes).
// CreateHabitForm was refactored to use this too; no behavior change there,
// same fields, same defaults, same JSX, just relocated.
export function HabitRecurrenceFields({
  value,
  onChange,
  disabled,
}: {
  value: HabitRecurrenceValue;
  onChange: (next: HabitRecurrenceValue) => void;
  disabled?: boolean;
}) {
  const {
    frequency,
    daysOfWeek,
    intervalDays,
    intervalWeeks,
    monthlyMode,
    dayOfMonth,
    lastDayOfMonth,
    monthlyWeekday,
    monthlyOrdinal,
    intervalMonths,
    endMode,
    count,
    until,
    daysOfMonth,
    monthlyWeekdaySet,
  } = value;

  function set<K extends keyof HabitRecurrenceValue>(key: K, next: HabitRecurrenceValue[K]) {
    onChange({ ...value, [key]: next });
  }

  function toggleDay(iso: number) {
    set('daysOfWeek', daysOfWeek.includes(iso) ? daysOfWeek.filter((d) => d !== iso) : [...daysOfWeek, iso].sort());
  }

  function toggleDayOfMonth(day: number) {
    set('daysOfMonth', daysOfMonth.includes(day) ? daysOfMonth.filter((d) => d !== day) : [...daysOfMonth, day].sort((a, b) => a - b));
  }

  function toggleWeekdaySetDay(iso: number) {
    set(
      'monthlyWeekdaySet',
      monthlyWeekdaySet.includes(iso) ? monthlyWeekdaySet.filter((d) => d !== iso) : [...monthlyWeekdaySet, iso].sort((a, b) => a - b),
    );
  }

  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => set('frequency', 'DAILY')}
          aria-pressed={frequency === 'DAILY'}
          className={`flex-1 rounded-control px-3 py-1.5 text-xs font-medium ${
            frequency === 'DAILY'
              ? 'bg-accent text-white'
              : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
          }`}
        >
          Every day
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => set('frequency', 'WEEKLY')}
          aria-pressed={frequency === 'WEEKLY'}
          className={`flex-1 rounded-control px-3 py-1.5 text-xs font-medium ${
            frequency === 'WEEKLY'
              ? 'bg-accent text-white'
              : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
          }`}
        >
          Specific days
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => set('frequency', 'MONTHLY')}
          aria-pressed={frequency === 'MONTHLY'}
          className={`flex-1 rounded-control px-3 py-1.5 text-xs font-medium ${
            frequency === 'MONTHLY'
              ? 'bg-accent text-white'
              : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
          }`}
        >
          Monthly
        </button>
      </div>

      {frequency === 'DAILY' && (
        <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
          Every
          <input
            type="number"
            min={1}
            max={30}
            value={intervalDays}
            onChange={(e) => set('intervalDays', Math.max(1, Number(e.target.value) || 1))}
            disabled={disabled}
            aria-label="Repeat every N days"
            className="w-14 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
          />
          day{intervalDays === 1 ? '' : 's'}
        </label>
      )}

      {frequency === 'WEEKLY' && (
        <>
          <div className="flex gap-1">
            {DAY_LABELS.map(({ iso, label }) => (
              <button
                key={iso}
                type="button"
                disabled={disabled}
                onClick={() => toggleDay(iso)}
                aria-pressed={daysOfWeek.includes(iso)}
                className={`flex-1 rounded-control py-1.5 text-xs font-medium ${
                  daysOfWeek.includes(iso)
                    ? 'bg-accent text-white'
                    : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            Every
            <input
              type="number"
              min={1}
              max={12}
              value={intervalWeeks}
              onChange={(e) => set('intervalWeeks', Math.max(1, Number(e.target.value) || 1))}
              disabled={disabled}
              aria-label="Repeat every N weeks"
              className="w-14 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
            />
            week{intervalWeeks === 1 ? '' : 's'}
          </label>
        </>
      )}

      {frequency === 'MONTHLY' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => set('monthlyMode', 'DAY_OF_MONTH')}
              aria-pressed={monthlyMode === 'DAY_OF_MONTH'}
              className={`flex-1 rounded-control px-2 py-1.5 text-xs font-medium ${
                monthlyMode === 'DAY_OF_MONTH'
                  ? 'bg-accent text-white'
                  : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
              }`}
            >
              A day of the month
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => set('monthlyMode', 'NTH_WEEKDAY')}
              aria-pressed={monthlyMode === 'NTH_WEEKDAY'}
              className={`flex-1 rounded-control px-2 py-1.5 text-xs font-medium ${
                monthlyMode === 'NTH_WEEKDAY'
                  ? 'bg-accent text-white'
                  : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
              }`}
            >
              A specific weekday
            </button>
            {/* BYSETPOS / multiple weekdays per month increment. */}
            <button
              type="button"
              disabled={disabled}
              onClick={() => set('monthlyMode', 'DAYS_OF_MONTH')}
              aria-pressed={monthlyMode === 'DAYS_OF_MONTH'}
              className={`flex-1 rounded-control px-2 py-1.5 text-xs font-medium ${
                monthlyMode === 'DAYS_OF_MONTH'
                  ? 'bg-accent text-white'
                  : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
              }`}
            >
              Several days
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => set('monthlyMode', 'NTH_WEEKDAY_SET')}
              aria-pressed={monthlyMode === 'NTH_WEEKDAY_SET'}
              className={`flex-1 rounded-control px-2 py-1.5 text-xs font-medium ${
                monthlyMode === 'NTH_WEEKDAY_SET'
                  ? 'bg-accent text-white'
                  : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
              }`}
            >
              A set of weekdays
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            Every
            <input
              type="number"
              min={1}
              max={24}
              value={intervalMonths}
              onChange={(e) => set('intervalMonths', Math.max(1, Number(e.target.value) || 1))}
              disabled={disabled}
              aria-label="Repeat every N months"
              className="w-14 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
            />
            month{intervalMonths === 1 ? '' : 's'}
          </label>

          {monthlyMode === 'DAY_OF_MONTH' && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary dark:text-text-secondary-dark">
              <label className="flex items-center gap-2">
                Day
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => set('dayOfMonth', Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
                  disabled={disabled || lastDayOfMonth}
                  aria-label="Day of the month"
                  className="w-14 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={lastDayOfMonth}
                  onChange={(e) => set('lastDayOfMonth', e.target.checked)}
                  disabled={disabled}
                  // Deliberately doesn't contain the substring "day of the
                  // month" anywhere (the spinbutton's own aria-label just
                  // above) — it used to (twice now: the original wording,
                  // then a first attempted fix that still had "last day of
                  // the month" inside it), and since accessible-name
                  // queries (both assistive tech and this app's own e2e
                  // suite's getByLabel calls) match by substring, any
                  // overlap makes the two controls indistinguishable by
                  // name alone.
                  aria-label="Always use whichever day is last in that month, instead of a fixed number"
                />
                Last day of the month
              </label>
            </div>
          )}

          {monthlyMode === 'NTH_WEEKDAY' && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              The
              <select
                value={monthlyOrdinal}
                onChange={(e) => set('monthlyOrdinal', Number(e.target.value))}
                disabled={disabled}
                aria-label="Which occurrence of the month"
                className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-secondary dark:text-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {ORDINAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={monthlyWeekday}
                onChange={(e) => set('monthlyWeekday', Number(e.target.value))}
                disabled={disabled}
                aria-label="Weekday"
                className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-secondary dark:text-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {WEEKDAY_OPTIONS.map((w) => (
                  <option key={w.iso} value={w.iso}>
                    {w.label}
                  </option>
                ))}
              </select>
              of the month
            </div>
          )}

          {/* BYSETPOS / multiple weekdays per month increment: reuses the
              same 1-31 grid-of-toggle-buttons pattern the weekday picker
              above already established, applied to day-of-month numbers
              instead — every selected day fires in the same month's rule. */}
          {monthlyMode === 'DAYS_OF_MONTH' && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
                Pick at least 2 days of the month
              </span>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <button
                    key={day}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleDayOfMonth(day)}
                    aria-pressed={daysOfMonth.includes(day)}
                    aria-label={`Day ${day} of the month`}
                    className={`rounded-control py-1 text-xs font-medium ${
                      daysOfMonth.includes(day)
                        ? 'bg-accent text-white'
                        : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reuses the same ordinal <select> NTH_WEEKDAY uses above, plus
              the same Mon-Sun toggle-button row WEEKLY uses — but as a
              multi-select set here, not one specific weekday. */}
          {monthlyMode === 'NTH_WEEKDAY_SET' && (
            <div className="flex flex-col gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              <div className="flex flex-wrap items-center gap-2">
                The
                <select
                  value={monthlyOrdinal}
                  onChange={(e) => set('monthlyOrdinal', Number(e.target.value))}
                  disabled={disabled}
                  aria-label="Which occurrence among the selected weekdays"
                  className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-xs text-text-secondary dark:text-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {ORDINAL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                day among:
              </div>
              <div className="flex gap-1">
                {DAY_LABELS.map(({ iso, label }) => (
                  <button
                    key={iso}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleWeekdaySetDay(iso)}
                    aria-pressed={monthlyWeekdaySet.includes(iso)}
                    className={`flex-1 rounded-control py-1.5 text-xs font-medium ${
                      monthlyWeekdaySet.includes(iso)
                        ? 'bg-accent text-white'
                        : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fuller habit recurrence increment: orthogonal to every shape above
          — applies the same whether the habit is daily, weekly, or monthly,
          so it sits outside the frequency-specific blocks rather than being
          duplicated inside each one. */}
      <div className="flex flex-col gap-2">
        <span className="text-xs text-text-secondary dark:text-text-secondary-dark">Ends</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => set('endMode', 'NEVER')}
            aria-pressed={endMode === 'NEVER'}
            className={`flex-1 rounded-control px-2 py-1.5 text-xs font-medium ${
              endMode === 'NEVER'
                ? 'bg-accent text-white'
                : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
            }`}
          >
            Never
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => set('endMode', 'COUNT')}
            aria-pressed={endMode === 'COUNT'}
            className={`flex-1 rounded-control px-2 py-1.5 text-xs font-medium ${
              endMode === 'COUNT'
                ? 'bg-accent text-white'
                : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
            }`}
          >
            After N times
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => set('endMode', 'UNTIL')}
            aria-pressed={endMode === 'UNTIL'}
            className={`flex-1 rounded-control px-2 py-1.5 text-xs font-medium ${
              endMode === 'UNTIL'
                ? 'bg-accent text-white'
                : 'border border-border text-text-secondary dark:border-border-dark dark:text-text-secondary-dark'
            }`}
          >
            On a date
          </button>
        </div>

        {endMode === 'COUNT' && (
          <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            Stop after
            <input
              type="number"
              min={1}
              max={1000}
              value={count}
              onChange={(e) => set('count', Math.max(1, Number(e.target.value) || 1))}
              disabled={disabled}
              aria-label="Number of times before this habit stops recurring"
              className="w-16 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
            />
            occurrence{count === 1 ? '' : 's'}
          </label>
        )}

        {endMode === 'UNTIL' && (
          <label className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            Last occurrence on
            <input
              type="date"
              value={until}
              onChange={(e) => set('until', e.target.value)}
              disabled={disabled}
              aria-label="Date this habit stops recurring after"
              className="rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-2 py-1 text-sm text-text-primary dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
        )}
      </div>
    </>
  );
}
