import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { Subscription } from './subscription.model';

export enum Chronotype {
  EARLY_BIRD = 'EARLY_BIRD',
  NIGHT_OWL = 'NIGHT_OWL',
  NEUTRAL = 'NEUTRAL',
}
registerEnumType(Chronotype, { name: 'Chronotype' });

// Resumable onboarding wizard increment — see schema.prisma's comment on
// the matching Prisma enum for the full reasoning.
export enum OnboardingWizardStep {
  CALENDAR = 'CALENDAR',
  PLAN = 'PLAN',
}
registerEnumType(OnboardingWizardStep, { name: 'OnboardingWizardStep' });

// Mirrors User in the API Design Document §4.2. Implements the Node
// interface's `id: ID!` contract even though the interface type itself is
// added to the schema in a later increment once more Node-typed entities
// exist (Task, CalendarEvent, ...).
@ObjectType()
export class User {
  @Field(() => ID)
  id!: string;

  @Field()
  email!: string;

  @Field({ nullable: true })
  displayName?: string;

  @Field()
  timezone!: string;

  @Field(() => Chronotype, { nullable: true })
  chronotype?: Chronotype;

  @Field({ nullable: true })
  onboardingCompletedAt?: Date;

  // Resumable onboarding wizard increment — see schema.prisma's comment on
  // the matching column for the full reasoning.
  @Field(() => OnboardingWizardStep, { nullable: true })
  onboardingWizardStep?: OnboardingWizardStep;

  // Smart notifications increment — see schema.prisma's comment on these
  // same columns for why they live directly on User rather than a separate
  // preferences table.
  @Field({ nullable: true })
  quietHoursStart?: string;

  @Field({ nullable: true })
  quietHoursEnd?: string;

  // Wake-up alarm increment (2026-09-02) — see schema.prisma's comment on
  // this same column for why it's a separate preference from quietHoursEnd.
  @Field({ nullable: true })
  wakeUpTime?: string;

  @Field()
  pushNotificationsEnabled!: boolean;

  @Field()
  emailNotificationsEnabled!: boolean;

  @Field()
  smsNotificationsEnabled!: boolean;

  // SMS delivery increment.
  @Field({ nullable: true })
  phoneNumber?: string;

  // Notification controls increment (2026-08-25).
  @Field()
  voiceNotificationsEnabled!: boolean;

  // Morning plan auto-apply increment (2026-09-05) — see schema.prisma's
  // comment on this same column.
  @Field()
  autoApplyMorningPlanEnabled!: boolean;

  // Diagnostic onboarding increment — see schema.prisma's comment on these
  // same columns for why they live directly on User (mirrors quietHoursStart/
  // End's own precedent) rather than a dedicated onboarding-answers table.
  @Field({ nullable: true })
  workHoursStart?: string;

  @Field({ nullable: true })
  workHoursEnd?: string;

  // Visible settings screen increment — see schema.prisma's comment on this
  // same column for why it exists: without it, TimezoneSync's silent
  // browser-detected auto-write would clobber a manual choice made from
  // /settings the next time any page loads.
  @Field()
  timezoneManual!: boolean;

  // Configurable Pomodoro durations increment — see schema.prisma's
  // comment on these same columns. `null` (the default for every account
  // that's never touched Settings) means "use the classic 25/5/15-every-4th
  // cadence," resolved client-side in apps/web/src/app/focus/page.tsx, the
  // same place these constants always lived before this increment.
  @Field(() => Int, { nullable: true })
  pomodoroWorkMinutes?: number;

  @Field(() => Int, { nullable: true })
  pomodoroShortBreakMinutes?: number;

  @Field(() => Int, { nullable: true })
  pomodoroLongBreakMinutes?: number;

  @Field(() => Int, { nullable: true })
  pomodoroCyclesBeforeLongBreak?: number;

  // Configurable reminder windows/thresholds increment — see schema.prisma's
  // comment on these same columns. `null` (the default for every account
  // that's never touched Settings) means "use SchedulerService's fixed
  // 8am/8pm/9pm/15-120min defaults."
  @Field(() => Int, { nullable: true })
  reminderMorningRoutineHour?: number;

  @Field(() => Int, { nullable: true })
  reminderEveningRoutineHour?: number;

  @Field(() => Int, { nullable: true })
  reminderReflectionHour?: number;

  @Field(() => Int, { nullable: true })
  reminderHabitMinOverdueMinutes?: number;

  @Field(() => Int, { nullable: true })
  reminderHabitMaxOverdueMinutes?: number;

  // Configurable daily reflection questions increment — see schema.prisma's
  // comment on these same columns. `null` (the default for every account
  // that's never touched Settings) means "use the classic wording" (What
  // went well today? / What was challenging? / What do you want to carry
  // into tomorrow?), resolved client-side in apps/web/src/app/reflection/
  // page.tsx, the same place those defaults always lived before this
  // increment.
  @Field({ nullable: true })
  reflectionWentWellLabel?: string;

  @Field({ nullable: true })
  reflectionChallengingLabel?: string;

  @Field({ nullable: true })
  reflectionCarryForwardLabel?: string;

  @Field(() => Subscription)
  subscription!: Subscription;
}
