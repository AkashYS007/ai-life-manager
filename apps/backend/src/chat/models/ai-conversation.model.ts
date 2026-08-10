import { Field, ID, ObjectType } from '@nestjs/graphql';
import { AiMessage } from './chat-message.model';

// Mirrors AiConversation in the API Design Document §4.4, except `messages`
// is a plain bounded list rather than a Relay connection this increment
// (see the schema.prisma comment on AiConversation for the rationale).
@ObjectType()
export class AiConversation {
  @Field(() => ID)
  id!: string;

  @Field({ nullable: true })
  title?: string;

  @Field()
  startedAt!: Date;

  @Field()
  lastMessageAt!: Date;

  @Field(() => [AiMessage])
  messages!: AiMessage[];
}
