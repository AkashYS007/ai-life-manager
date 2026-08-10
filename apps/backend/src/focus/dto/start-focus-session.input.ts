import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { FocusSessionKind } from '../models/focus-session.model';

@InputType()
export class StartFocusSessionInput {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  taskId?: string;

  // 180-minute ceiling is a sanity bound, not a product decision — nothing
  // in the PRD specifies a max, but an unbounded "planned duration" invites
  // garbage input more than it serves a real use case. 25 is the
  // conventional single-Pomodoro default the client pre-fills, not enforced
  // here — this field just needs *a* value.
  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(180)
  plannedDurationMinutes!: number;

  // Automatic Pomodoro work/break cycling increment: omitted defaults to
  // WORK in the service layer (every pre-Pomodoro client call omits this
  // entirely and keeps working exactly as before). The Pomodoro auto-cycler
  // is the only caller that ever sends BREAK.
  @Field(() => FocusSessionKind, { nullable: true })
  @IsOptional()
  @IsEnum(FocusSessionKind)
  kind?: FocusSessionKind;
}
