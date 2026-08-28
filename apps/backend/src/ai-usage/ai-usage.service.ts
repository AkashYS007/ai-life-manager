import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { estimateCostUsd } from '../common/ai-pricing';
import { AiUsageByFeature, AiUsageSummary } from './models/ai-usage-summary.model';

export interface RecordUsageParams {
  userId: string | null;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const DEFAULT_SUMMARY_WINDOW_DAYS = 30;
const BUDGET_WINDOW_DAYS = 30;

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // Called from every real AnthropicClient call site (JournalService,
  // PlannerService, ChatService x2, RecommendationsService,
  // ReflectionService) right after a real API call succeeds. Deliberately
  // best-effort: a failure writing this row (a transient DB blip, a
  // still-migrating schema in an environment that hasn't run this
  // increment's migration yet) must never surface to the person waiting on
  // the actual AI reply, the same "telemetry can't break the feature it
  // measures" discipline this app's delivery-retry work already
  // established for notifications. Fire-and-forget from the caller's own
  // perspective — callers `await` this only so the process doesn't exit
  // mid-write on a serverless-style cold shutdown, not because a slow write
  // here should ever delay a response back to the person.
  async record(params: RecordUsageParams): Promise<void> {
    try {
      const estimatedCostUsd = estimateCostUsd(params.model, params.inputTokens, params.outputTokens);
      await this.prisma.aiUsageEvent.create({
        data: {
          userId: params.userId,
          feature: params.feature,
          model: params.model,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          estimatedCostUsd: estimatedCostUsd === null ? null : estimatedCostUsd,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to record AI usage event (feature=${params.feature}): ${(error as Error).message}`);
    }
  }

  // Real aggregation over real rows, computed fresh on every read — same
  // "no persisted counter to go stale" choice this codebase already made
  // for the Goals task count (see GoalsService's own comment). Summed in
  // JS, not a DB-side SUM, specifically because `estimatedCostUsd` can be
  // null per-row (an unpriced model) and the total must stay null-aware
  // too: a SQL SUM silently treats NULL as "ignore it," which would make a
  // total that's actually partially unknown look like a complete, trustworthy
  // number. `totalEstimatedCostUsd` is null only when *every* row in the
  // window is unpriced; a window with any priced calls returns the sum of
  // just those, since a partial-but-honest total is more useful than none
  // at all, as long as it's never confused with a complete one — which is
  // exactly what byFeature's own per-feature null already flags for whoever
  // reads this.
  async getSummary(userId: string, days: number = DEFAULT_SUMMARY_WINDOW_DAYS): Promise<AiUsageSummary> {
    const windowDays = Math.max(1, Math.min(days, 365));
    const since = DateTime.now().minus({ days: windowDays }).toJSDate();

    const events = await this.prisma.aiUsageEvent.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { feature: true, inputTokens: true, outputTokens: true, estimatedCostUsd: true },
    });

    const byFeatureMap = new Map<string, { callCount: number; inputTokens: number; outputTokens: number; costUsd: number; anyUnpriced: boolean }>();

    for (const event of events) {
      const bucket = byFeatureMap.get(event.feature) ?? {
        callCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        anyUnpriced: false,
      };
      bucket.callCount += 1;
      bucket.inputTokens += event.inputTokens;
      bucket.outputTokens += event.outputTokens;
      if (event.estimatedCostUsd === null) {
        bucket.anyUnpriced = true;
      } else {
        bucket.costUsd += Number(event.estimatedCostUsd);
      }
      byFeatureMap.set(event.feature, bucket);
    }

    const byFeature: AiUsageByFeature[] = Array.from(byFeatureMap.entries())
      .map(([feature, bucket]) => {
        // A feature bucket where *some but not all* calls are priced still
        // reports the known partial sum, same reasoning as the overall
        // total below — only a feature with zero priced calls reports
        // undefined (GraphQL's "not present" — see AiUsageByFeature's own
        // Float field, nullable but not typed to carry a literal `null`).
        const knownCost = bucket.costUsd > 0 || !bucket.anyUnpriced;
        return {
          feature,
          callCount: bucket.callCount,
          inputTokens: bucket.inputTokens,
          outputTokens: bucket.outputTokens,
          estimatedCostUsd: knownCost ? bucket.costUsd : undefined,
        };
      })
      .sort((a, b) => b.callCount - a.callCount);

    const totalCalls = events.length;
    const totalInputTokens = byFeature.reduce((sum, f) => sum + f.inputTokens, 0);
    const totalOutputTokens = byFeature.reduce((sum, f) => sum + f.outputTokens, 0);
    const pricedFeatures = byFeature.filter((f) => f.estimatedCostUsd !== null && f.estimatedCostUsd !== undefined);
    const totalEstimatedCostUsd =
      pricedFeatures.length === 0 ? null : pricedFeatures.reduce((sum, f) => sum + (f.estimatedCostUsd ?? 0), 0);

    return {
      windowDays,
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      totalEstimatedCostUsd: totalEstimatedCostUsd === null ? undefined : totalEstimatedCostUsd,
      byFeature,
    };
  }

  // Rolling-window total for the budget check below — a real DB-side SUM
  // (unlike getSummary's JS sum above, which needs to distinguish "zero"
  // from "unknown" per feature for a human-facing breakdown). Here we only
  // need one number to compare against a cap, and SQL SUM's "ignore NULL
  // rows" behavior is the right call: an unpriced call (a model with no
  // known $/token rate) simply doesn't count toward anyone's spend cap,
  // which is the conservative, fail-open direction to be wrong in.
  async getTotalCostSince(userId: string, since: Date): Promise<number> {
    const result = await this.prisma.aiUsageEvent.aggregate({
      where: { userId, createdAt: { gte: since } },
      _sum: { estimatedCostUsd: true },
    });
    return Number(result._sum.estimatedCostUsd ?? 0);
  }

  // Per-user monthly AI spend cap (performance/scalability pass,
  // 2026-08-28). Fails OPEN on every "we can't tell" case — unset cap,
  // unparseable cap, non-positive cap — because a misconfigured cap must
  // never accidentally lock every user out of AI features; only a
  // deliberately, correctly configured one should ever block someone. Read
  // via ConfigService (not process.env directly) since env.validation.ts
  // already declares and normalizes this var app-wide.
  async isOverBudget(userId: string): Promise<boolean> {
    const rawCap = this.config.get<string>('AI_MONTHLY_COST_CAP_USD');
    if (!rawCap) {
      return false;
    }
    const cap = Number(rawCap);
    if (!Number.isFinite(cap) || cap <= 0) {
      this.logger.warn(`AI_MONTHLY_COST_CAP_USD is set but not a valid positive number ("${rawCap}") — ignoring, no cap enforced.`);
      return false;
    }
    const since = DateTime.now().minus({ days: BUDGET_WINDOW_DAYS }).toJSDate();
    const totalCostUsd = await this.getTotalCostSince(userId, since);
    return totalCostUsd >= cap;
  }
}
