import { redirect } from 'next/navigation';

// Today is the default landing screen on every platform (UI/UX Design
// Document §4) — the product's whole thesis is that the day is the unit of
// value, not a generic home/dashboard shell.
export default function RootPage() {
  redirect('/today');
}
