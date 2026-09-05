import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { PlanDiff } from './plan-change.model';

export enum PlanRunStatus {
  PROPOSED = 'PROPOSED',
  ACCEPTED = 'ACCEPTED',
  EDITED = 'EDITED',
  REJECTED = 'REJECTED',
}
registerEnumType(PlanRunStatus, { name: 'PlanRunStatus' });

// EDIT (Editing a proposed AI plan increment): lets a person tweak one or
// more proposed times, or drop a single suggestion outright, then applies
// the resulting (possibly-modified) plan the same way ACCEPT does — see
// PlannerService.respondToPlanRun's EDIT branch and PlanChangeEditInput.
export enum PlanRunDecision {
  ACCEPT = 'ACCEPT',
  EDIT = 'EDIT',
  REJECT = 'REJECT',
}
registerEnumType(PlanRunDecision, { name: 'PlanRunDecision' });

// Weekly/monthly AI plan generation increment (PRD §7.4's "AI daily/weekly/
// monthly plan generation" row) — widens the same requestReplan/AiPlanRun
// machinery the daily planner already uses to a longer time horizon, rather
// than building a separate system. DAY is the default everywhere (both in
// this enum's GraphQL default and PlannerService.requestReplan's TS default
// parameter) so every existing call site — the Today screen's plan card,
// every prior e2e test — keeps behaving exactly as it did before this
// increment with zero changes required on their part.
export enum PlanScope {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}
registerEnumType(PlanScope, { name: 'PlanScope' });

// Mirrors AiPlanRun in the API Design Document §4.4. `EDITED` is a real,
// now-implemented status value — the Editing a proposed AI plan increment
// wires up the EDIT decision the doc always specified (see PlanRunDecision
// above and PlannerService.respondToPlanRun).
@ObjectType()
export class AiPlanRun {
  @Field(() => ID)
  id!: string;

  @Field()
  triggerEvent!: string;

  @Field(() => PlanRunStatus)
  status!: PlanRunStatus;

  @Field(() => PlanScope)
  scope!: PlanScope;

  @Field(() => PlanDiff)
  diff!: PlanDiff;

  @Field()
  modelUsed!: string;

  @Field()
  generatedAt!: Date;

  @Field({ nullable: true })
  respondedAt?: Date;

  // Morning plan auto-apply increment (2026-09-05) — see schema.prisma's
  // comment on this same column. Non-null and in the future means "still
  // PROPOSED, will auto-apply at this time unless reviewed first"; the
  // frontend uses this to show a real countdown/notice rather than letting
  // an auto-apply happen with no warning.
  @Field({ nullable: true })
  autoApplyAt?: Date;
}
