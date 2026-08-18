import Link from 'next/link';

// Public marketing landing page for signed-out visitors (added 2026-08-18).
//
// Why this exists: page.tsx used to unconditionally redirect() every visitor
// straight to /today, including anonymous ones. That's fine for a returning
// signed-in user, but it meant an anonymous visitor -- or, critically,
// Google's OAuth-verification crawler checking the "Application home page"
// link on the consent screen -- never saw any actual page content, just a
// redirect chain ending at a sign-in wall. Google's branding-verification
// review flagged exactly this: "Your home page does not explain the purpose
// of your app" and "the app name configured for your OAuth consent screen
// does not match the app name on your home page." This component is the
// fix -- real, crawlable content that names the app and explains what it
// does, rendered only for signed-out visitors (see page.tsx for the
// signed-in-still-redirects-to-/today branch).
export function LandingPage() {
  return (
    <main
      id="main-content"
      className="min-h-screen bg-background px-5 py-16 dark:bg-background-dark"
    >
      <div className="mx-auto max-w-2xl">
        {/* The literal app name comes first, as the actual page heading --
            not a small kicker label above a different headline. Google's
            OAuth branding verification flagged "the app name configured for
            your OAuth consent screen does not match the app name on your
            home page" against the previous version, where "AI Life Manager"
            was de-emphasized text above an H1 that said something else.
            Google's consent screen has the app name configured as exactly
            "AI Life Manager" (see Cloud Console > Google Auth Platform >
            Branding > App name) -- this H1 now matches that string exactly,
            so there's no ambiguity for either a human reviewer or an
            automated checker. */}
        <h1 className="text-3xl font-semibold leading-tight text-text-primary dark:text-text-primary-dark sm:text-4xl">
          AI Life Manager
        </h1>
        <p className="mt-2 text-lg font-medium text-accent dark:text-accent-dark">
          Your AI Chief of Staff for the whole day.
        </p>
        <p className="mt-4 text-base leading-relaxed text-text-secondary dark:text-text-secondary-dark">
          AI Life Manager plans your day around your energy, not just your deadlines. It reminds you to eat, move,
          and rest, prioritizes your open tasks based on how you're actually feeling, and keeps everything in sync
          with the calendar you already use.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/sign-up"
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white dark:bg-accent-dark"
          >
            Get started
          </Link>
          <Link
            href="/sign-in"
            className="rounded-lg border border-text-secondary/30 px-5 py-2.5 text-sm font-medium text-text-primary dark:border-text-secondary-dark/30 dark:text-text-primary-dark"
          >
            Sign in
          </Link>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2">
          <Feature
            title="Energy-aware planning"
            body="Log your mood, energy, and sleep, and let the AI planner propose realistic times for your open tasks instead of just stacking them by due date."
          />
          <Feature
            title="Calendar sync"
            body="Connect Google, Microsoft, or Apple Calendar so events you schedule in AI Life Manager show up where you already look, and vice versa."
          />
          <Feature
            title="Focus sessions & reflection"
            body="Start a focus session when you're ready to work, and close the day with a short reflection instead of just closing the laptop."
          />
          <Feature
            title="Habits & journal, in one place"
            body="Track routines and goals alongside a running journal, so the app has real context for what it recommends next."
          />
        </div>

        <footer className="mt-16 flex gap-4 text-xs text-text-secondary dark:text-text-secondary-dark">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </footer>
      </div>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl bg-surface p-4 dark:bg-surface-dark">
      <h2 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-text-secondary dark:text-text-secondary-dark">{body}</p>
    </div>
  );
}
