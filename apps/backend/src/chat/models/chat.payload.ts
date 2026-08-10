import { Field, ObjectType } from '@nestjs/graphql';
import { AiConversation } from './ai-conversation.model';
import { UserError } from '../../common/errors/user-error.model';

@ObjectType()
export class SendChatMessagePayload {
  @Field(() => AiConversation, { nullable: true })
  conversation?: AiConversation;

  @Field(() => [UserError])
  errors!: UserError[];
}
