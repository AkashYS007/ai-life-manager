import Link from 'next/link';

// Public, unauthenticated page — required reading for Google's OAuth
// verification of the calendar.events sensitive scope (Google requires the
// privacy policy to be publicly visible, hosted on the same domain as the
// app's home page, and to specifically disclose how Google user data is
// accessed/used/stored/shared). Added to middleware.ts's isPublicRoute list
// alongside this file so it's reachable without a Clerk session — a
// reviewer (human or automated) visiting this URL must never hit a
// sign-in wall.
//
// This is a good-faith policy written to accurately describe what this
// app's code actually does (see the codebase: Clerk for auth, Stripe for
// billing, Anthropic's API for the AI planner/chat, Resend for email,
// web-push for notifications, Google/Microsoft/Apple for calendar sync).
// It is not a substitute for review by a lawyer before this app is used by
// real, non-demo users at any scale — flagged to the app owner separately,
// not as a disclaimer on this page.
const LAST_UPDATED = 'August 18, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-base font-semibold text-text-primary dark:text-text-primary-dark">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-text-secondary dark:text-text-secondary-dark">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-2xl bg-background px-5 py-10 dark:bg-background-dark">
      <Link href="/" className="text-xs font-medium text-accent dark:text-accent-dark">
        ← AI Life Manager
      </Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold text-text-primary dark:text-text-primary-dark">
        Privacy Policy
      </h1>
      <p className="mb-8 text-xs text-text-secondary dark:text-text-secondary-dark">Last updated: {LAST_UPDATED}</p>

      <Section title="Overview">
        <p>
          AI Life Manager (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;the app&rdquo;) is a personal planning app that
          helps you organize tasks, habits, journal entries, goals, and your calendar in one place, with an AI
          assistant that helps you plan your day. This policy explains what information we collect, how we use it,
          and the choices you have.
        </p>
      </Section>

      <Section title="Information we collect">
        <p>
          <span className="font-medium text-text-primary dark:text-text-primary-dark">Account information.</span>{' '}
          When you sign up, our authentication provider (Clerk) collects your name and email address to create and
          secure your account.
        </p>
        <p>
          <span className="font-medium text-text-primary dark:text-text-primary-dark">Content you create.</span> Tasks,
          habits, journal entries, goals, routines, reflections, and messages you send to the AI assistant are
          stored so the app can function — this is the core of what the app does.
        </p>
        <p>
          <span className="font-medium text-text-primary dark:text-text-primary-dark">Calendar data.</span> If you
          choose to connect Google Calendar, Microsoft (Outlook/365) Calendar, or Apple Calendar, we access the
          calendar events in the account you connect (titles, times, descriptions, and attendees as made available
          by the provider) so we can show them alongside your tasks and let the AI assistant plan around your
          existing commitments. See &ldquo;Google user data&rdquo; below for how this specifically applies to Google
          Calendar.
        </p>
        <p>
          <span className="font-medium text-text-primary dark:text-text-primary-dark">Billing information.</span> If
          you subscribe to a paid plan, payment is handled directly by Stripe. We do not receive or store your card
          number — we only receive confirmation of your subscription status from Stripe.
        </p>
        <p>
          <span className="font-medium text-text-primary dark:text-text-primary-dark">Device and usage data.</span> If
          you enable notifications, we store a push-notification subscription token for your browser/device so we
          can send reminders. We also store your timezone so schedules and reminders show at the right local time.
        </p>
      </Section>

      <Section title="Google user data">
        <p>
          When you connect Google Calendar, the app requests Google&rsquo;s{' '}
          <code className="rounded bg-surface px-1 py-0.5 text-xs dark:bg-surface-dark">calendar.events</code> scope
          and your basic account email. We use this access only to:
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>Read your existing Google Calendar events so they appear in your unified calendar view.</li>
          <li>Let the AI planner take your existing events into account when suggesting a schedule.</li>
          <li>Create or update calendar events on your behalf when you explicitly ask the app to schedule something.</li>
        </ul>
        <p>
          We do not use Google user data for advertising, and we do not sell, rent, or transfer Google user data to
          any third party except the service providers listed below, each of which processes it solely to help us
          operate the app on our behalf. Our use of information received from Google APIs adheres to the{' '}
          <a
            className="text-accent underline dark:text-accent-dark"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. You can disconnect Google Calendar at any time from the
          app&rsquo;s Calendar screen, and you can separately revoke the app&rsquo;s access at any time from your{' '}
          <a
            className="text-accent underline dark:text-accent-dark"
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
          >
            Google Account permissions page
          </a>
          .
        </p>
      </Section>

      <Section title="How we share information">
        <p>We share information only with the service providers that help us run the app, each for a specific purpose:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <span className="font-medium text-text-primary dark:text-text-primary-dark">Clerk</span> — authentication
            and account management.
          </li>
          <li>
            <span className="font-medium text-text-primary dark:text-text-primary-dark">Stripe</span> — subscription
            billing and payment processing.
          </li>
          <li>
            <span className="font-medium text-text-primary dark:text-text-primary-dark">Anthropic</span> — powers the
            AI assistant; relevant task, goal, and calendar context is sent to Anthropic&rsquo;s API to generate
            plans, recommendations, and chat responses.
          </li>
          <li>
            <span className="font-medium text-text-primary dark:text-text-primary-dark">Resend</span> — delivers
            transactional and reminder emails.
          </li>
          <li>
            <span className="font-medium text-text-primary dark:text-text-primary-dark">
              Google, Microsoft, and Apple
            </span>{' '}
            — only for the calendar account(s) you explicitly connect, solely to sync calendar events.
          </li>
        </ul>
        <p>We do not sell your personal information, and we do not share it for third-party advertising purposes.</p>
      </Section>

      <Section title="Data storage and security">
        <p>
          Your data is stored in an encrypted, access-controlled database. Calendar account credentials (OAuth
          tokens for Google/Microsoft, and the app-specific password for Apple) are encrypted at rest before
          storage and are only decrypted in memory when needed to sync your calendar.
        </p>
      </Section>

      <Section title="Data retention and deletion">
        <p>
          You can disconnect any connected calendar account at any time from the Calendar screen, which deletes the
          stored credentials for that account immediately. You can delete your account entirely from Settings,
          which removes your account and associated data from our systems.
        </p>
      </Section>

      <Section title="Your choices">
        <p>
          Connecting a calendar account is entirely optional — the rest of the app works fully without it. You can
          disconnect at any time, and doing so does not affect any other part of your account.
        </p>
      </Section>

      <Section title="Children's privacy">
        <p>
          AI Life Manager is not directed to, and is not intended for use by, children under 13, and we do not
          knowingly collect personal information from children under 13.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy from time to time. If we make material changes, we will update the &ldquo;Last
          updated&rdquo; date above.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          Questions about this policy or your data? Contact us at{' '}
          <a className="text-accent underline dark:text-accent-dark" href="mailto:akash.yerehalli.satish@gmail.com">
            akash.yerehalli.satish@gmail.com
          </a>
          .
        </p>
      </Section>

      <Link href="/terms" className="text-xs font-medium text-accent dark:text-accent-dark">
        View Terms of Service →
      </Link>
    </main>
  );
}
