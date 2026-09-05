import { TasksService } from '../tasks/tasks.service';
import { AiPlanRun, PlanScope } from './models/ai-plan-run.model';
import { PlanChangeType } from './models/plan-change.model';
import { StoredDiff } from './planner-types';

// planner.service.ts modularization increment (2026-08-26): shared by both
// plan-generation.service.ts (requestReplan) and plan-response.service.ts
// (respondToPlanRun) — a plain function taking the already-injected
// TasksService as a parameter rather than its own @Injectable() class,
// since it has no state of its own and this avoids either service needing
// to depend on the other (or on a third DI-only wrapper) just to share this
// one piece of logic.

// Expands the stored { taskId, ... } diff into the GraphQL PlanDiff shape
// (real Task objects), same "service layer shapes the response, GraphQL
// model never knows about the storage representation" split as
// TasksService.toGraphTask flattening the task_tags join table.
export async function hydratePlanRun(tasksService: TasksService, userId: string, record: any): Promise<AiPlanRun> {
  const diff = record.diff as StoredDiff;
  const taskIds = diff.changes.map((c) => c.taskId);
  const tasks = await tasksService.listByIds(userId, taskIds);
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  return {
    id: record.id,
    triggerEvent: record.triggerEvent,
    status: record.status,
    scope: record.scope as PlanScope,
    modelUsed: record.modelUsed,
    generatedAt: record.generatedAt,
    respondedAt: record.respondedAt ?? undefined,
    // Morning plan auto-apply increment (2026-09-05).
    autoApplyAt: record.autoApplyAt ?? undefined,
    diff: {
      summary: diff.summary,
      changes: diff.changes
        .filter((c) => taskById.has(c.taskId))
        .map((c, i) => ({
          // Editing a proposed AI plan increment: a plan generated before
          // this shipped has no `id` stored on its changes at all — a
          // stable-within-this-response placeholder keeps this field
          // genuinely non-null (never a GraphQL null-for-non-nullable
          // crash, see the PlanDiff.summary bug fix in
          // plan-generation.service.ts for the exact shape of that
          // mistake) without pretending it's a real, edit-targetable id;
          // PlanChangeEditInput.changeId simply won't match anything for a
          // change from a plan this old.
          id: c.id ?? `legacy-${i}`,
          changeType: PlanChangeType.MOVE,
          task: taskById.get(c.taskId),
          previousStart: c.previousStart ? new Date(c.previousStart) : undefined,
          proposedStart: new Date(c.proposedStart),
          proposedEnd: new Date(c.proposedEnd),
          reason: c.reason,
        })),
    },
  } as unknown as AiPlanRun;
}
