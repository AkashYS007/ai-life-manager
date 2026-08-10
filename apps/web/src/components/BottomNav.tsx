'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// All seven are real routes now — Journal was the last plain-label
// placeholder (an honest "not built yet," not a dead link), until this
// increment.
const linked = [
  { label: 'Today', href: '/today' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Habits', href: '/habits' },
  { label: 'Journal', href: '/journal' },
  { label: 'Chat', href: '/chat' },
  { label: 'Memory', href: '/memory' },
  { label: 'More', href: '/more' },
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
