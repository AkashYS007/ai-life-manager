import { Field, InputType, Int } from '@nestjs/graphql';
import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

// Customize act-on defaults at the point of acting increment. Every field
// here is optional and category-specific — the resolver/service only ever
// reads the ones that apply to whichever category the target recommendation
// actually is (durationMinutes for BREAK/WORKOUT, startTime for WORKOUT
// only, priority/dueDate for MEAL only); sending a field that doesn't apply
// to the recommendation being acted on is simply ignored, not rejected,
// same "the caller doesn't need to know which category it is ahead of time"
// spirit as the payload's own startedFocusSessionId/bookedCalendarEventId/
// createdTaskId trio already has. Every field omitted (the whole `input`
// argument omitted, even) reproduces the exact one-tap default behavior
// this feature has always had — nothing here narrows or changes what a
// plain `actOnRecommendation(id: "...")` call with no input does.
@InputType()
export class ActOnRecommendationInput {
  // BREAK and WORKOUT. Same 1-180 sanity ceiling
  // StartFocusSessionInput.plannedDurationMinutes already uses — a real
  // bound, not a product decision (see that field's own comment).
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  durationMinutes?: number;

  // WORKOUT only. Omitted means "right now," the same default the
  // Booking a workout as a real calendar block increment always used.
  // Deliberately unrestricted otherwise (no "must be in the future" check)
  // — same "no extra validation beyond providing a real value" precedent
  // CreateCalendarEventInput's own startTime already sets, which already
  // allows a person to log a plain past event by hand.
  @Field({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startTime?: Date;

  // MEAL only. Same 1-4 bound as CreateTaskInput's own priority field.
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  priority?: number;

  // MEAL only.
  @Field({ nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;
}
