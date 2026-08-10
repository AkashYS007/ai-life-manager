import { Field, ObjectType } from '@nestjs/graphql';
import { ChatMessageRole } from './chat-message.model';

// Real-time chat streaming increment. `requestId` is a client-generated
// correlation id (a fresh one per message sent, not the conversation's own
// id) — a brand-new chat has no conversation id yet until sendChatMessage
// StreamingCreates one, but the client still needs to subscribe *before*
// firing that mutation so it doesn't miss the first chunk. Generating its
// own id and passing the same value to both the subscription and the
// mutation sidesteps that ordering problem entirely, without the server
// needing to invent and hand back an id in a separate round trip first.
@ObjectType()
export class ChatStreamChunk {
  @Field()
  requestId!: string;

  // Tool-calling actions in Chat increment: ASSISTANT for a real streamed
  // token of the model's own words (many small chunks per segment, same as
  // before this increment), TOOL for one real action having just been
  // executed server-side (published once, as a whole summary, not
  // character-by-character — a completed action isn't something that was
  // "typed" by the model the way a reply is). Never USER — nothing here
  // ever streams the person's own message back to them. Lets the frontend
  // start a new bubble/segment whenever this changes from the previous
  // chunk, the same role-per-message shape the final persisted
  // conversation already has.
  @Field(() => ChatMessageRole)
  role!: ChatMessageRole;

  // Empty on the final `done: true` event — that event exists purely as a
  // signal to stop appending and let the still-in-flight mutation's own
  // resolved conversation take over as the source of truth, not to carry
  // one last piece of text.
  @Field()
  delta!: string;

  @Field()
  done!: boolean;
}
