import Link from 'next/link';

// Public, unauthenticated page — see privacy/page.tsx's header comment for
// why this route exists and why it's added to middleware.ts's
// isPublicRoute list alongside it. Linked from the Privacy Policy (Google's
// verification requirements ask the privacy policy to link to the app's
// terms of service) and from the Google OAuth consent screen's "Link to
// Terms of Service" field.
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

export default function TermsOfServicePage() {
  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-2xl bg-background px-5 py-10 dark:bg-background-dark">
      <Link href="/" className="text-xs font-medium text-accent dark:text-accent-dark">
        ← AI Life Manager
      </Link>
      <h1 className="mb-1 mt-4 text-2xl font-semibold text-text-primary dark:text-text-primary-dark">
        Terms of Service
      </h1>
      <p className="mb-8 text-xs text-text-secondary dark:text-text-secondary-dark">Last updated: {LAST_UPDATED}</p>

      <Section title="1. Agreement">
        <p>
          By creating an account or using AI Life Manager (&ldquo;the app&rdquo;), you agree to these Terms of
          Service and our{' '}
          <Link href="/privacy" className="text-accent underline dark:text-accent-dark">
            Privacy Policy
          </Link>
          . If you don&rsquo;t agree, please don&rsquo;t use the app.
        </p>
      </Section>

      <Section title="2. What the app does">
        <p>
          AI Life Manager helps you plan your day and manage tasks, habits, goals, journaling, and your calendar,
          with an AI assistant that offers suggestions and can create or update calendar events on your behalf when
          you ask it to.
        </p>
      </Section>

      <Section title="3. Your account">
        <p>
          You&rsquo;re responsible for keeping your account credentials secure and for all activity under your
          account. You must provide accurate information when creating an account.
        </p>
      </Section>

      <Section title="4. Subscriptions and billing">
        <p>
          Some features may be offered as paid plans, billed and processed through Stripe. Where paid plans are
          active, pricing is shown in the app before you subscribe, and you can cancel at any time from Settings —
          cancellation takes effect at the end of the current billing period.
        </p>
      </Section>

      <Section title="5. Connected calendar accounts">
        <p>
          Connecting Google, Microsoft, or Apple Calendar is optional and under your control. By connecting an
          account, you authorize the app to read (and, where you request it, create or update) calendar events in
          that account, as described in our{' '}
          <Link href="/privacy" className="text-accent underline dark:text-accent-dark">
            Privacy Policy
          </Link>
          . You can disconnect any connected account at any time.
        </p>
      </Section>

      <Section title="6. AI-generated content">
        <p>
          The app&rsquo;s AI assistant generates suggestions, plans, and scheduling recommendations. These are
          provided for general planning purposes only and are not professional medical, financial, legal, or
          psychological advice. You&rsquo;re responsible for reviewing and deciding whether to act on anything the
          AI assistant suggests, especially before it creates or modifies calendar events on your behalf.
        </p>
      </Section>

      <Section title="7. Acceptable use">
        <p>
          You agree not to misuse the app — including attempting to disrupt its operation, accessing accounts that
          aren&rsquo;t yours, or using it for any unlawful purpose.
        </p>
      </Section>

      <Section title="8. Intellectual property">
        <p>
          The app, its design, and its underlying software are owned by us. The content you create in the app
          (your tasks, journal entries, goals, and similar) remains yours.
        </p>
      </Section>

      <Section title="9. Termination">
        <p>
          You may stop using the app and delete your account at any time from Settings. We may suspend or terminate
          accounts that violate these terms.
        </p>
      </Section>

      <Section title="10. Disclaimer and limitation of liability">
        <p>
          The app is provided &ldquo;as is&rdquo; without warranties of any kind. To the fullest extent permitted by
          law, we are not liable for indirect, incidental, or consequential damages arising from your use of the
          app, including reliance on AI-generated suggestions or on the accuracy of synced calendar data.
        </p>
      </Section>

      <Section title="11. Changes to these terms">
        <p>
          We may update these terms from time to time. If we make material changes, we will update the &ldquo;Last
          updated&rdquo; date above.
        </p>
      </Section>

      <Section title="12. Contact us">
        <p>
          Questions about these terms? Contact us at{' '}
          <a className="text-accent underline dark:text-accent-dark" href="mailto:akash.yerehalli.satish@gmail.com">
            akash.yerehalli.satish@gmail.com
          </a>
          .
        </p>
      </Section>

      <Link href="/privacy" className="text-xs font-medium text-accent dark:text-accent-dark">
        ← View Privacy Policy
      </Link>
    </main>
  );
}
