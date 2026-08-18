import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { LandingPage } from './LandingPage';

// Today is the default landing screen for a signed-in user on every platform
// (UI/UX Design Document §4) -- the product's whole thesis is that the day
// is the unit of value, not a generic home/dashboard shell. That part is
// unchanged.
//
// What changed (2026-08-18): this used to redirect() unconditionally, for
// every visitor, signed in or not. That broke Google's OAuth branding
// verification, which crawls the "Application home page" link on the
// consent screen anonymously and expects to find real content naming the
// app and explaining its purpose -- not a redirect straight into a Clerk
// sign-in wall. See LandingPage.tsx for the actual page content; this file
// now only decides which of the two a given visitor gets.
export default async function RootPage() {
  if (process.env.NEXT_PUBLIC_AUTH_MODE === 'clerk') {
    const { userId } = await auth();
    if (!userId) {
      return <LandingPage />;
    }
  }
  redirect('/today');
}
