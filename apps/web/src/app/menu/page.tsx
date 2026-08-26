import Link from 'next/link';
import { BottomNav } from '../../components/BottomNav';

// Navigation decluttering increment (frontend UX pass, 2026-08-25). Every
// one of these eight destinations used to be reachable only via a wrapping
// row of small text links stacked at the very top of Today, added one at a
// time across eight separate increments (each with its own "not a
// bottom-nav tab, reachable from Today instead" comment — see today/page.tsx's
// git history) with nobody ever stepping back to ask what that row had
// become in aggregate. This page is that step back: a real navigation hub,
// reached from a single menu icon (TodayHeader) instead, so Today goes back
// to being about *today* and everything else gets one deliberate home.
//
// Grouped by what a person is actually doing, not by when each feature
// shipped — "Plan & review" (the AI/task-planning surfaces), "Daily
// rituals" (recurring, once-a-day actions), "Account" (settings and the one
// interrupt-driven item, Notifications, kept here too for anyone who didn't
// use TodayHeader's bell). Completed tasks — this page's own prior
// existence as the bottom nav's literal "More" tab — gets its own row
// rather than being silently dropped: same content, same route
// (`/more`), just reached one more deliberate way now instead of being the
// bottom nav's only destination under a label that never actually said
// what it was.
const GROUPS: Array<{
  title: string;
  items: Array<{ href: string; label: string; description: string }>;
}> = [
  {
    title: 'Plan & review',
    items: [
      { href: '/tasks', label: 'Tasks', description: 'Every open task — priority, duration, and goal.' },
      { href: '/goals', label: 'Goals', description: 'What your tasks are actually working toward.' },
      { href: '/analytics', label: 'Insights', description: 'Trends and correlations across mood, sleep, and energy.' },
      { href: '/more', label: 'Completed tasks', description: "Everything you've checked off, most recent first." },
    ],
  },
  {
    title: 'Daily rituals',
    items: [
      { href: '/focus', label: 'Focus', description: 'Start a timed focus session.' },
      { href: '/reflection', label: 'Reflect on today', description: 'Three quick questions to close out your day.' },
      { href: '/routines', label: 'Routines', description: 'Set up and check off your morning and evening routine.' },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/notifications', label: 'Notifications', description: 'Everything sent to you, and what triggered it.' },
      { href: '/settings', label: 'Settings', description: 'Name, timezone, work hours, and reminder preferences.' },
    ],
  },
];

export default function MenuPage() {
  return (
    <main id="main-content" className="mx-auto max-w-md rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Menu</h1>
        <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
          Everything that isn&apos;t on Today.
        </p>
      </div>

      <div className="mx-4 mb-4 flex flex-col gap-5">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
              {group.title}
            </h2>
            <div className="flex flex-col gap-2">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center justify-between gap-3 rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">{item.label}</p>
                    <p className="mt-0.5 text-xs text-text-secondary dark:text-text-secondary-dark">
                      {item.description}
                    </p>
                  </div>
                  <span aria-hidden="true" className="text-text-secondary dark:text-text-secondary-dark">
                    →
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
