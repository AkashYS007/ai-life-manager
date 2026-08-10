import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { AuthContext } from '../auth/auth-context';
import { UsersService } from '../users/users.service';
import { User, OnboardingWizardStep } from '../users/models/user.model';
import { CompleteOnboardingPayload } from './models/onboarding.payload';
import { RecordOnboardingWizardStepPayload } from './models/record-onboarding-wizard-step.payload';
import { CompleteOnboardingInput } from './dto/complete-onboarding.input';
import { OnboardingService } from './onboarding.service';

@Resolver()
@UseGuards(AuthGuard)
export class OnboardingResolver {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly usersService: UsersService,
  ) {}

  // The Diagnostic quiz step's submit action (UI/UX Design Document §10) —
  // no separate "skip onboarding" mutation exists because this one already
  // accepts every field as optional and always stamps
  // onboardingCompletedAt, so a person who dismisses every question and hits
  // "Continue" still calls this with an all-empty input and still gets
  // marked onboarded (see OnboardingService.complete).
  @Mutation(() => CompleteOnboardingPayload)
  async completeOnboarding(
    @CurrentAuth() auth: AuthContext,
    @Args('input') input: CompleteOnboardingInput,
  ): Promise<CompleteOnboardingPayload> {
    try {
      const authedUser = await this.usersService.getOrCreateFromAuth(auth);
      const user = await this.onboardingService.complete(authedUser.id, input);
      return { user: user as unknown as User, errors: [] };
    } catch {
      return {
        errors: [{ code: 'ONBOARDING_FAILED', message: "We couldn't save your answers. Try again." }],
      };
    }
  }

  // Resumable onboarding wizard increment. Called once, best-effort, from
  // the calendar step's own Continue button — see onboarding/page.tsx's own
  // comment on why a failure here never blocks moving to the next step
  // client-side. `completeOnboarding` above already records the CALENDAR
  // transition itself, so this mutation is only ever called with PLAN in
  // practice, but it's written to accept either since nothing about its own
  // logic depends on that.
  @Mutation(() => RecordOnboardingWizardStepPayload)
  async recordOnboardingWizardStep(
    @CurrentAuth() auth: AuthContext,
    @Args('step', { type: () => OnboardingWizardStep }) step: OnboardingWizardStep,
  ): Promise<RecordOnboardingWizardStepPayload> {
    try {
      const authedUser = await this.usersService.getOrCreateFromAuth(auth);
      const user = await this.onboardingService.recordWizardStep(authedUser.id, step);
      return { user: user as unknown as User, errors: [] };
    } catch {
      return {
        errors: [{ code: 'RECORD_STEP_FAILED', message: "We couldn't save your progress. Try again." }],
      };
    }
  }
}
