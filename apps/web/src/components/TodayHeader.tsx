import Link from 'next/link';

// Bell icon (outline) — hand-rolled inline, same "small, narrow-purpose SVG,
// not worth a new icon-library dependency" judgment call this codebase
// already made for its analytics charts (see TrendChart's own comment).
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
    </svg>
  );
}

// Menu (hamburger) icon — same reasoning as BellIcon above.
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

// Navigation decluttering increment (frontend UX pass, 2026-08-25): Today
// used to be the *only* entry point to eight other destinations (Focus,
// Reflection, Routines, Notifications, Goals, Insights, Tasks, Settings),
// all crammed into a wrapping row of small text links at the very top of
// the page, on top of Today's own already-substantial real content
// (routines, check-in, AI plan, recommendations, habits, events, tasks).
// That row is gone from today/page.tsx now — everything it used to link to
// lives in the new /menu hub instead (see that page's own comment), reached
// from here via one icon instead of eight lines of text. Notifications is
// the one exception kept directly on Today, as its own bell icon rather
// than folded into the menu: unlike the other seven, it's genuinely
// time-sensitive/interrupt-driven (the whole point of a badge count is
// "something new happened," which a menu a person has to remember to open
// defeats), the same reasoning most apps keep a notifications bell outside
// any hamburger menu.
export function TodayHeader({
  greeting,
  name,
  unreadNotificationCount,
}: {
  greeting: string;
  name: string;
  unreadNotificationCount?: number;
}) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-6 pb-3">
      <div>
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">{today}</p>
        {/* Sleek/futuristic visual redesign (2026-09-01): the greeting is
            Today's single biggest headline moment, so it gets the new
            `display` face plus a dark-mode-only gradient treatment (white →
            `nova.dark`) rather than a flat text color — light mode is left
            exactly as it was, since the gradient is tuned against the dark
            background only. */}
        <h1 className="mt-0.5 text-2xl font-medium font-display text-text-primary dark:bg-gradient-to-r dark:from-white dark:to-nova-dark dark:bg-clip-text dark:text-transparent">
          {greeting}, {name}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-4 pt-1.5">
        <Link
          href="/notifications"
          aria-label={
            unreadNotificationCount
              ? `Notifications, ${unreadNotificationCount} unread`
              : 'Notifications'
          }
          className="relative text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark"
        >
          <BellIcon />
          {!!unreadNotificationCount && (
            <span
              aria-hidden="true"
              className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium leading-none text-white dark:bg-danger-dark"
            >
              {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
            </span>
          )}
        </Link>
        <Link
          href="/menu"
          aria-label="Menu"
          className="text-text-secondary hover:text-ai-accent dark:text-text-secondary-dark"
        >
          <MenuIcon />
        </Link>
      </div>
    </div>
  );
}
