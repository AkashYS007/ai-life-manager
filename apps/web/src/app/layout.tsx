import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '../components/Providers';
import { PwaRegister } from '../components/PwaRegister';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

// PWA + offline support increment (PRD §10's platform requirement — "PWA on
// web" is part of the MVP definition itself, not a later polish pass): the
// manifest, icons, and apple-touch-icon below are what actually let a
// browser offer "Add to Home Screen"/"Install" at all — none of this did
// anything before this increment since no manifest existed.
export const metadata: Metadata = {
  title: 'AI Life Manager',
  description: 'Your AI Chief of Staff for the whole day.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  // Google Search Console domain verification (2026-08-18) — required for
  // Google OAuth verification of the calendar.events sensitive scope
  // (Google checks that the Authorized Domain on the OAuth consent screen
  // is verified in Search Console under the same account). Next.js's
  // `verification.google` field renders as
  // <meta name="google-site-verification" content="..." /> in <head>,
  // which is exactly what Search Console's HTML-tag method checks for.
  verification: {
    google: '64GfA56P6RHQaJI8ssk1zWlq2YupI7_ETg1AHlKNT_o',
  },

export const viewport: Viewport = {
  themeColor: '#4C4CFF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {/* Registers the service worker (see public/sw.js) — mounted once,
            app-wide, same "invisible, no UI of its own" pattern TimezoneSync
            already established for a background client-side effect. */}
        <PwaRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
