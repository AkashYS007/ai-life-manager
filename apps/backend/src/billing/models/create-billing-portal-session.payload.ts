import { Field, ObjectType } from '@nestjs/graphql';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class CreateBillingPortalSessionPayload {
  @Field({ nullable: true })
  portalUrl?: string;

  @Field(() => [UserError])
  errors!: UserError[];
}
