import { estimateCostUsd } from './ai-pricing';

// AI cost telemetry increment (2026-08-25). Same "the one piece of this
// increment that's pure logic and can actually be tested deterministically
// in this sandbox" reasoning as common/retry.spec.ts (Update 53) — no
// Prisma, no live DB, no network, just the pricing math itself.
describe('estimateCostUsd', () => {
  it('prices this app\'s own configured default model (Claude Sonnet 5) correctly', () => {
    // $2/M input, $10/M output — see ai-pricing.ts's own sourcing comment.
    expect(estimateCostUsd('claude-sonnet-5-20260301', 1_000_000, 0)).toBe(2);
    expect(estimateCostUsd('claude-sonnet-5-20260301', 0, 1_000_000)).toBe(10);
  });

  it('combines input and output cost for a real mixed call', () => {
    // 1,000 input tokens ($0.002) + 500 output tokens ($0.005) = $0.007
    expect(estimateCostUsd('claude-sonnet-5', 1000, 500)).toBeCloseTo(0.007, 6);
  });

  it('returns null (never a fabricated number) for a model not in the pricing table', () => {
    expect(estimateCostUsd('some-future-unpriced-model', 1000, 1000)).toBeNull();
  });

  it('returns 0, not null, for a real zero-token call on a priced model', () => {
    // A genuinely known cost of exactly $0 (e.g. a 0-token edge case) is a
    // different thing from an unknown cost — see AiUsageService.getSummary's
    // own comment on why the two must never be conflated.
    expect(estimateCostUsd('claude-sonnet-5', 0, 0)).toBe(0);
  });

  it('does not match a retired model rate against a newer, unrelated model string', () => {
    // Opus 4's rate ($15/$75) must never accidentally match 'claude-opus-4.5'
    // ($5/$25, a real, current, differently-priced model) — regression test
    // for the exact kind of substring-collision ai-pricing.ts's own comment
    // on match ordering warns about.
    expect(estimateCostUsd('claude-opus-4.5-20260301', 1_000_000, 0)).toBe(5);
    expect(estimateCostUsd('claude-opus-4-20250101', 1_000_000, 0)).toBe(15);
  });
});
