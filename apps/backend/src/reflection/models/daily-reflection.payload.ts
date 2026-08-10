import { Field, ObjectType } from '@nestjs/graphql';
import { DailyReflection } from './daily-reflection.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class SubmitDailyReflectionPayload {
  @Field(() => DailyReflection, { nullable: true })
  reflection?: DailyReflection;

  @Field(() => [UserError])
  errors!: UserError[];
}
