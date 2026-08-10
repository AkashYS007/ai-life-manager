import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsDate, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

// Editing a proposed AI plan increment (API Design Document §4.4's
// previously-reserved EDIT decision, now implemented) — one entry per
// proposed change someone wants to touch before accepting the rest of the
// plan as-is. `changeId` references PlanChange.id, a per-change id first
// added by this increment (see plan-change.model.ts) — editing can only
// target a change from a plan generated after this shipped, not an older
// plan run that predates per-change ids existing at all (see README).
@InputType()
export class PlanChangeEditInput {
  @Field()
  @IsString()
  changeId!: string;

  // A new time to move this change to. Omit and set `remove: true` instead
  // to drop the suggestion entirely rather than move it — providing both
  // is treated as remove taking priority (see
  // PlannerService.respondToPlanRun's EDIT branch).
  @Field({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  proposedStart?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  remove?: boolean;
}
