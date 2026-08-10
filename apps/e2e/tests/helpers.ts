// Shared across every spec. `unique()` gives every spec its own
// unmistakable, timestamped string to create data with and later assert on
// by exact text match — the substitute for the backend e2e suite's
// per-test fresh-account isolation, which isn't available here (see
// playwright.config.ts's own comment on why).
export function unique(label: string): string {
  return `${label} ${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
