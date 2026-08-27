// planner.service.ts modularization increment (2026-08-26): the stored-diff
// shape used by both the generation path (plan-generation.service.ts) and
// the response path (plan-response.service.ts) — split out to its own file
// specifically so neither service needs to import the other just to see
// this type, which would otherwise be the only reason for a dependency
// between them.

// The stored shape of AiPlanRun.diff (Json column) — deliberately smaller
// than the GraphQL PlanDiff/PlanChange types (no hydrated Task object, just
// the taskId), since this is what actually gets persisted and re-read.
// `id` was added by the Editing a proposed AI plan increment — optional in
// this stored-shape type (not the GraphQL type, which always exposes one —
// see hydratePlanRun's backfill) since a plan row persisted before this
// increment genuinely has no `id` on its stored changes at all.
export interface StoredChange {
  id?: string;
  changeType: 'MOVE';
  taskId: string;
  previousStart: string | null;
  proposedStart: string;
  proposedEnd: string;
  reason: string;
}

export interface StoredDiff {
  summary: string;
  changes: StoredChange[];
}
