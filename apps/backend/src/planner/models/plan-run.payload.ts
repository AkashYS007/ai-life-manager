import { Field, ObjectType } from '@nestjs/graphql';
import { AiPlanRun } from './ai-plan-run.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class RequestReplanPayload {
  @Field(() => AiPlanRun, { nullable: true })
  planRun?: AiPlanRun;

  @Field(() => [UserError])
  errors!: UserError[];
}

@ObjectType()
export class RespondToPlanRunPayload {
  @Field(() => AiPlanRun, { nullable: true })
  planRun?: AiPlanRun;

  @Field(() => [UserError])
  errors!: UserError[];
}
