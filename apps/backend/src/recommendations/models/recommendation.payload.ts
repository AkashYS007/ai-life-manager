import { Field, ID, ObjectType } from '@nestjs/graphql';
import { AiRecommendationRun } from './recommendation.model';
import { UserError } from '../../common/errors/user-error.model';

// Shared by generateRecommendations and dismissRecommendation — both ever
// return is the current state of today's run, same { entity, errors } shape
// every other mutation payload in this app uses, no need for two near-
// identical payload types.
@ObjectType()
export class RecommendationRunPayload {
  @Field(() => AiRecommendationRun, { nullable: true })
  recommendationRun?: AiRecommendationRun;

  @Field(() => [UserError])
  errors!: UserError[];
}

// AI recommendations acting on your behalf increment. Distinct from
// RecommendationRunPayload above because actOnRecommendation can produce one
// of three different real, newly-created things depending on the
// recommendation's category — never more than one — so the client knows
// exactly what just got created without having to inspect the message text
// itself: `startedFocusSessionId` for a BREAK (a real IN_PROGRESS
// FocusSession row), `bookedCalendarEventId` for a WORKOUT (a real
// CalendarEvent row — see the Booking a workout as a real calendar block
// increment), `createdTaskId` for a MEAL (a real open Task row).
// `recommendationRun` is still included, same as the other two mutations,
// so the card's own refetch keeps working the same way — acting on a
// recommendation dismisses it, same as the × button, just for a different
// reason.
@ObjectType()
export class ActOnRecommendationPayload {
  @Field(() => AiRecommendationRun, { nullable: true })
  recommendationRun?: AiRecommendationRun;

  @Field(() => ID, { nullable: true })
  startedFocusSessionId?: string;

  @Field(() => ID, { nullable: true })
  bookedCalendarEventId?: string;

  @Field(() => ID, { nullable: true })
  createdTaskId?: string;

  @Field(() => [UserError])
  errors!: UserError[];
}
