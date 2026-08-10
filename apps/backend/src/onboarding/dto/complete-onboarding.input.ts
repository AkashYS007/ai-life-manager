import { Field, InputType } from '@nestjs/graphql';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Chronotype } from '../../users/models/user.model';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/; // same convention/regex as UpdateNotificationPreferencesInput

// The Diagnostic quiz's answer shape (UI/UX Design Document §10, step 3:
// "5-6 short questions... rendered as large single-choice cards"). Every
// field is optional — a person can skip any question and still finish
// onboarding, since the PRD's real requirement is establishing *a* baseline
// fast, not blocking activation on a fully-filled-out form (§13 freemium
// strategy: get to the first AI plan as fast as possible).
@InputType()
export class CompleteOnboardingInput {
  @Field(() => Chronotype, { nullable: true })
  @IsOptional()
  @IsIn(Object.values(Chronotype))
  chronotype?: Chronotype;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(HH_MM, { message: 'workHoursStart must be in 24-hour HH:mm format' })
  workHoursStart?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(HH_MM, { message: 'workHoursEnd must be in 24-hour HH:mm format' })
  workHoursEnd?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(HH_MM, { message: 'quietHoursStart must be in 24-hour HH:mm format' })
  quietHoursStart?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(HH_MM, { message: 'quietHoursEnd must be in 24-hour HH:mm format' })
  quietHoursEnd?: string;

  // "Current biggest source of overload" (UI/UX Design Document §10 step 3)
  // — the PRD's "priorities" baseline. Free text from a single-choice-card
  // pick on the frontend (e.g. "Work/career"), stored as a real AI Memory
  // preference fact (see OnboardingService.complete) rather than a fixed
  // enum column, so it flows into every AI prompt the same way any other
  // manually-told-to-the-AI preference does — no separate "priorities" model
  // needed.
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  overloadSource?: string;

  // Diagnostic quiz free-text answers increment: the quiz's first genuinely
  // open-ended question — everything before this field was a fixed preset
  // pick from a card, never typed text (see this class's own header comment
  // and overloadSource's comment, both written before this field existed).
  // Optional, same "skip anything, still finish onboarding" rule as every
  // other field here. Stored verbatim as a real AI Memory preference fact
  // (see OnboardingService.complete), not summarized by an extra AI call —
  // same "simple, real counting/plain text over data that already exists"
  // discipline the Automatic AI Memory learning increment established,
  // applied here to a single short answer rather than a batch of history.
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  freeTextNotes?: string;
}
