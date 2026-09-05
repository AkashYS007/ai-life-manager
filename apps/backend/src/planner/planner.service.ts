import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { MemoryService } from '../memory/memory.service';
import { AnthropicClient } from './anthropic-client';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { AiPlanRun, PlanRunDecision, PlanScope } from './models/ai-plan-run.model';
import { PlanChangeEditInput } from './dto/plan-change-edit.input';
import { PlanChangeAddInput } from './dto/plan-change-add.input';
import { PlanGenerationService } from './plan-generation.service';
import { PlanResponseService } from './plan-response.service';
import { PlannerAutoReplanListener } from './plan-auto-replan.listener';
import { hydratePlanRun } from './planner-hydration';

// planner.service.ts modularization increment (2026-08-26): this file used
// to be 1,146 lines — nearly 2x the next-largest service in the backend —
// holding plan generation, the auto-replan event-listener cluster, the
// accept/reject/edit policy layer, task-duration estimation, and every
// shared prompt/parsing/hydration helper, all in one class. Mapped into 4
// natural seams back in project update 59 and split out here into focused
// files: plan-generation.service.ts, plan-auto-replan.listener.ts,
// plan-response.service.ts, plus the pure shared pieces
// (planner-helpers.ts, planner-prompt.ts, planner-hydration.ts,
// planner-types.ts).
//
// PlannerService itself is kept, deliberately, as a thin façade — same
// class name, same public method signatures — because three real things
// outside this module depend on exactly that: PlannerResolver and
// today.resolver.ts inject `PlannerService` by name and call its public
// methods, and the e2e suite does `moduleRef.get(PlannerService)` and then
// calls `.maybeAutoReplan(...)` directly on it. None of those needed to
// change for this refactor — every method below is either genuinely small
// (isConfigured, getLatest, estimateDuration) or a one-line delegate to the
// new focused service that now actually owns that logic. Zero behavior
// change; this is an "extract" refactor, not a rewrite.
@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly memoryService: MemoryService,
    private readonly anthropic: AnthropicClient,
    // AI cost telemetry increment.
    private readonly aiUsage: AiUsageService,
    private readonly planGeneration: PlanGenerationService,
    private readonly planResponse: PlanResponseService,
    private readonly autoReplanListener: PlannerAutoReplanListener,
  ) {}

  isConfigured(): boolean {
    return this.anthropic.isConfigured();
  }

  // --- Generation ---------------------------------------------------------

  async requestReplan(
    userId: string,
    timezone: string,
    scope: PlanScope = PlanScope.DAY,
    triggerEvent: string = 'manual_request',
    // Morning plan auto-apply increment (2026-09-05) — passed straight
    // through to PlanGenerationService; see that file's own comment on this
    // same parameter. Every pre-existing call site omits it, unaffected.
    autoApplyDelayMinutes?: number,
  ): Promise<AiPlanRun> {
    return this.planGeneration.requestReplan(userId, timezone, scope, triggerEvent, autoApplyDelayMinutes);
  }

  // --- Automatic AI re-planning --------------------------------------------

  // Delegates to PlannerAutoReplanListener, which is where the real
  // per-scope cooldown/gate logic and every @OnEvent handler now live (see
  // that file's own top comment for why it has to be its own registered
  // provider, not just a plain class this one holds). Kept here, under this
  // exact name, specifically because the e2e suite calls
  // `moduleRef.get(PlannerService).maybeAutoReplan(...)` directly rather
  // than emitting a real event — this one-line delegate is what keeps that
  // call working unchanged.
  async maybeAutoReplan(userId: string, triggerEvent: string): Promise<void> {
    return this.autoReplanListener.maybeAutoReplan(userId, triggerEvent);
  }

  // --- Responding -----------------------------------------------------

  async respondToPlanRun(
    userId: string,
    id: string,
    decision: PlanRunDecision,
    edits: PlanChangeEditInput[] = [],
    adds: PlanChangeAddInput[] = [],
  ): Promise<AiPlanRun> {
    return this.planResponse.respondToPlanRun(userId, id, decision, edits, adds);
  }

  async getLatest(userId: string, scope: PlanScope = PlanScope.DAY): Promise<AiPlanRun | null> {
    const record = await this.prisma.aiPlanRun.findFirst({
      where: { userId, scope: scope as any },
      orderBy: { generatedAt: 'desc' },
    });
    if (!record) return null;
    return hydratePlanRun(this.tasksService, userId, record);
  }

  // --- Task duration estimation -------------------------------------------

  // "AI-assisted estimate" (PRD §7.1 Task management row) + "learns
  // actual-vs-estimated time per user, improves over time" (PRD §7.4 AI
  // Layer row) — the second half is real, not aspirational: buildContextBlock
  // now includes the task_duration_accuracy fact (see
  // memory.service.ts's refreshTaskDurationAccuracyPattern, written from
  // real completions), and that same context block is what gets injected
  // into this prompt below, so a person who consistently under-estimates
  // gets a nudged-up suggestion, not just the same generic estimate every
  // time. Lives here rather than on TasksService specifically to avoid a
  // module cycle — PlannerModule already imports TasksModule, so TasksModule
  // importing PlannerModule back (for AnthropicClient) would be circular.
  // Best-effort like every other optional AI call in this app: returns null
  // (not a thrown error) if the key isn't configured, the response can't be
  // parsed as a sane number of minutes, or the request fails outright — the
  // frontend's duration field always stays a normal, directly-editable
  // number input, this is only ever a suggestion dropped into it. Kept
  // directly on this façade (not extracted further) since it's small,
  // self-contained, and doesn't share any state with generation/response.
  async estimateDuration(userId: string, title: string, description?: string): Promise<number | null> {
    if (!this.anthropic.isConfigured()) return null;

    try {
      const context = await this.memoryService.buildContextBlock(userId);
      const system =
        'You estimate how long a personal task will realistically take, in minutes, for a specific user of a life-planning app. Reply with ONLY a single integer number of minutes — no words, no range, no explanation.';
      const prompt = [
        `Task: ${title}`,
        description ? `Details: ${description}` : undefined,
        context ? `What's known about this user's habits and past estimation accuracy:\n${context}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');

      const { content, modelUsed, usage } = await this.anthropic.sendMessage([{ role: 'user', content: prompt }], system);
      void this.aiUsage.record({
        userId,
        feature: 'planner_estimate_duration',
        model: modelUsed,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      });
      const match = content.match(/\d+/);
      if (!match) return null;

      const minutes = parseInt(match[0], 10);
      // Sanity bounds, not a hard product rule — same "validate before
      // trusting" spirit as RoutinesService.aiSequence's permutation check:
      // a wildly out-of-range reply (0, or "600 minutes for a 2-minute
      // task") is more likely a parsing artifact or a model mistake than a
      // real estimate worth showing.
      if (minutes < 1 || minutes > 480) return null;

      return minutes;
    } catch (error) {
      this.logger.warn(`AI duration estimate failed, leaving the field for manual entry: ${(error as Error).message}`);
      return null;
    }
  }
}

// Re-exported so existing consumers importing these from this exact path
// (chat.service.ts: `import { parseAiDateTime, DEFAULT_TASK_DURATION_MINUTES }
// from '../planner/planner.service'`) keep working unchanged — the actual
// definitions now live in planner-helpers.ts alongside the rest of the
// pure, stateless planner logic.
export { DEFAULT_TASK_DURATION_MINUTES, parseAiDateTime } from './planner-helpers';
