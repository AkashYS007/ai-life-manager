'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// All seven are real routes now — Journal was the last plain-label
// placeholder (an honest "not built yet," not a dead link), until this
// increment.
//
// Navigation decluttering increment (frontend UX pass, 2026-08-25): this
// seventh tab used to be labeled "More" but actually went straight to
// Completed tasks — a real feature, but not a navigation hub, despite being
// the one item in this list that looked and read like one. Repointed at the
// new /menu hub (see that page) instead, which is what "More" always should
// have meant; Completed tasks now has its own real entry inside that menu
// rather than silently occupying the bottom nav's only catch-all slot.
const linked = [
  { label: 'Today', href: '/today' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Habits', href: '/habits' },
  { label: 'Journal', href: '/journal' },
  { label: 'Chat', href: '/chat' },
  { label: 'Memory', href: '/memory' },
  { label: 'Menu', href: '/menu' },
];
const unbuilt: string[] = [];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex justify-around border-t border-border dark:border-border-dark py-2.5">
      {linked.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'text-xs font-medium text-accent dark:text-accent-dark'
                : 'text-xs text-text-secondary dark:text-text-secondary-dark'
            }
          >
            {item.label}
          </Link>
        );
      })}
      {unbuilt.map((label) => (
        <span key={label} className="text-xs text-text-secondary dark:text-text-secondary-dark">
          {label}
        </span>
      ))}
    </nav>
  );
}
