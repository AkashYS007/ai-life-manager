import { Field, ObjectType } from '@nestjs/graphql';
import { User } from '../../users/models/user.model';
import { UserError } from '../../common/errors/user-error.model';

// Resumable onboarding wizard increment. Same shape as CompleteOnboardingPayload
// right alongside it — a separate type per mutation, not a shared one, is
// the established convention here even when two payloads happen to look
// identical (see UpdateProfilePayload vs. ChangeSubscriptionTierPayload).
@ObjectType()
export class RecordOnboardingWizardStepPayload {
  @Field(() => User, { nullable: true })
  user?: User;

  @Field(() => [UserError])
  errors!: UserError[];
}
