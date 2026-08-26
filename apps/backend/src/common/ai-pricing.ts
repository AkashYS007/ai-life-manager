// AI cost telemetry increment (2026-08-25). This app's own knowledge of
// Anthropic's pricing lives in exactly one place — here — so a future price
// change is a one-file edit, not a hunt through every caller of
// AnthropicClient. Rates confirmed directly against Anthropic's own current
// pricing page (docs.claude.com/en/docs/about-claude/pricing) on 2026-08-25,
// not carried over from training data — pricing is a fact about the world
// today, not something safe to assume unchanged.
//
// Deliberately keyed by substring match, not an exact model-string map: the
// real value in ANTHROPIC_MODEL (and in each response's own `model` field,
// which is what AiUsageService actually looks up — see its own comment on
// why) can carry a dated suffix Anthropic adds/rotates over time (e.g. a
// snapshot pin), and matching the family name is more durable than trying to
// enumerate every exact string that could show up. Ordered most-specific
// first — 'haiku' must be checked before a hypothetical future match that
// could also contain 'claude' generically, though none of today's patterns
// actually collide.
//
// A model that matches nothing here returns `null`, not a guess — see
// estimateCostUsd's own comment for why a missing price must never silently
// become "$0" or an invented number.
interface ModelRate {
  pattern: RegExp;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

const MODEL_RATES: ModelRate[] = [
  // Claude Sonnet 5 — this app's own configured default (see env.validation.ts).
  { pattern: /sonnet-5|sonnet5/i, inputPerMillionUsd: 2, outputPerMillionUsd: 10 },
  // Opus 4.5 through 4.8 are priced identically to Opus 5, not to the older
  // (and far more expensive) plain "Opus 4"/4.1 line below — checked before
  // the generic opus-4 pattern specifically so this more-specific match wins
  // first; without this, every one of these four real, current model names
  // would incorrectly fall through to the legacy $15/$75 rate.
  { pattern: /opus-4\.[5-8]/i, inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
  { pattern: /opus-5|opus5/i, inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
  { pattern: /fable-5|fable5|mythos-5|mythos5/i, inputPerMillionUsd: 10, outputPerMillionUsd: 50 },
  { pattern: /sonnet-4/i, inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  { pattern: /haiku-4/i, inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
  // Retired/limited-availability models — kept so a historical row created
  // back when the app pointed at one of these still gets a real cost, not a
  // gap in this app's own spend history just because the model since aged
  // out. Matches plain "opus-4" and "opus-4.1" (and any other opus-4.x not
  // already claimed by the 4.5-4.8 rule above) — deliberately last among the
  // opus rules so it only ever catches what the more specific rule didn't.
  { pattern: /opus-4/i, inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
  { pattern: /haiku-3\.5|haiku-3-5/i, inputPerMillionUsd: 0.8, outputPerMillionUsd: 4 },
];

// Returns null (never a fabricated number) when `model` doesn't match any
// known rate — see AiUsageService.record's own comment for how that's
// surfaced: the real token counts are still recorded, `estimatedCostUsd`
// just stays null for that row until this table is updated.
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const rate = MODEL_RATES.find((r) => r.pattern.test(model));
  if (!rate) return null;
  const cost = (inputTokens / 1_000_000) * rate.inputPerMillionUsd + (outputTokens / 1_000_000) * rate.outputPerMillionUsd;
  // Rounded to 6 decimal places to match the schema's DECIMAL(10,6) column —
  // a single call is usually a fraction of a cent, and this keeps the stored
  // value exact rather than relying on the DB's own rounding behavior.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
