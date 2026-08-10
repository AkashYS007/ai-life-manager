import { Field, ObjectType } from '@nestjs/graphql';
import { Tag } from './tag.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class CreateTagPayload {
  @Field(() => Tag, { nullable: true })
  tag?: Tag;

  @Field(() => [UserError])
  errors!: UserError[];
}
