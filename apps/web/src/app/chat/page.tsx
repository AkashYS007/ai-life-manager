'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useSubscription } from '@apollo/client';
import {
  AI_CONVERSATIONS_QUERY,
  AI_CONVERSATION_QUERY,
  SEND_CHAT_MESSAGE_STREAMING,
  CHAT_STREAM_CHUNK_SUBSCRIPTION,
} from '../../lib/queries';
import { BottomNav } from '../../components/BottomNav';

interface Message {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'TOOL';
  content: string;
}

// Tool-calling actions in Chat increment: a TOOL-role message is a real
// action the AI just took (see chat.service.ts's executeTool), not
// something it "said" — rendered as a centered, pill-shaped system note
// rather than a left/right-aligned speech bubble, so it reads visually
// distinct from both the person's own messages and the AI's own words, the
// same way a "you both matched" or "call ended" system line looks
// different from a real message in most chat apps.
function MessageBubble({ role, content }: { role: string; content: string }) {
  if (role === 'TOOL') {
    return (
      <div className="flex justify-center" aria-live="polite">
        <div className="max-w-[90%] rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent dark:border-accent-dark/30 dark:bg-accent-dark/10 dark:text-accent-dark">
          ✓ {content}
        </div>
      </div>
    );
  }

  const isUser = role === 'USER';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-card px-3 py-2 text-sm ${
          isUser
            ? 'bg-accent text-white'
            : 'border border-border bg-surface text-text-primary dark:border-border-dark dark:bg-surface-dark dark:text-text-primary-dark'
        }`}
      >
        {content}
      </div>
    </div>
  );
}

// One contiguous run of streamed text under a single role — a new segment
// starts every time the role changes (ASSISTANT text, then a TOOL action,
// then more ASSISTANT text, for example), so each renders as its own
// MessageBubble exactly the way the final persisted messages will once the
// mutation resolves — no visual jump between "while streaming" and "after."
interface StreamSegment {
  role: 'ASSISTANT' | 'TOOL';
  text: string;
}

// Real-time chat streaming increment, extended by Tool-calling actions in
// Chat: the reply now grows into view as the AI actually generates it, over
// a real GraphQL subscription (see apps/backend/src/chat/chat.resolver.ts's
// chatStreamChunk and apps/backend/src/planner/anthropic-client.ts's
// streamMessage) — no more waiting on one opaque "Thinking…" indicator for
// several seconds before the whole reply appears at once. The AI can now
// also take three real actions when asked (create a task, complete one, or
// reschedule one) — see chat.service.ts's executeTool for what actually
// runs server-side; anything else it still can't do, and says so.
export default function ChatPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A fresh, client-generated id per in-flight send — see
  // ChatStreamChunk's own comment for why: it lets the subscription below
  // start listening *before* a brand-new conversation even has a real id
  // yet. null whenever nothing is currently streaming.
  const [streamingRequestId, setStreamingRequestId] = useState<string | null>(null);
  const [streamingSegments, setStreamingSegments] = useState<StreamSegment[]>([]);
  // Screen-reader pass: the streaming bubbles above are visual-only and
  // update per token, which is deliberately NOT wrapped in aria-live — a
  // live region re-announcing on every token would be unusably noisy for a
  // screen reader (confirmed against the WAI-ARIA "keep live regions calm"
  // guidance). Instead this sr-only region gets exactly one update, once
  // streaming finishes, with the reply's complete text — the same "batch,
  // don't spam" pattern real chat apps use for live transcription. A ref
  // mirrors streamingSegments so the `finally` block below can read the
  // truly-final text without a stale closure (state captured when
  // handleSend started would miss chunks that arrived afterward).
  const [completedAnnouncement, setCompletedAnnouncement] = useState('');
  const segmentsRef = useRef<StreamSegment[]>([]);

  const { data: listData } = useQuery(AI_CONVERSATIONS_QUERY);
  const { data: threadData, loading: threadLoading } = useQuery(AI_CONVERSATION_QUERY, {
    variables: { id: conversationId },
    skip: !conversationId,
  });

  const [sendChatMessageStreaming, { loading: sending }] = useMutation(SEND_CHAT_MESSAGE_STREAMING, {
    refetchQueries: [{ query: AI_CONVERSATIONS_QUERY }],
  });

  // Only actually subscribes once streamingRequestId is set — `skip`
  // keeps this idle (no socket traffic at all) the rest of the time.
  // Appends each real chunk to the current segment, or starts a new one
  // whenever the role changes from the previous chunk (see StreamSegment's
  // own comment) — the final `done: true` event carries no text of its
  // own, it's purely the cue these segments are about to be replaced by
  // the mutation's own authoritative persisted messages.
  useSubscription(CHAT_STREAM_CHUNK_SUBSCRIPTION, {
    variables: { requestId: streamingRequestId },
    skip: !streamingRequestId,
    onData: ({ data }) => {
      const chunk = data.data?.chatStreamChunk;
      if (!chunk || chunk.done) return;
      setStreamingSegments((prev) => {
        const last = prev[prev.length - 1];
        const next =
          last && last.role === chunk.role
            ? [...prev.slice(0, -1), { role: last.role, text: last.text + chunk.delta }]
            : [...prev, { role: chunk.role, text: chunk.delta }];
        segmentsRef.current = next;
        return next;
      });
    },
  });

  const conversations = listData?.aiConversations ?? [];
  const messages: Message[] = threadData?.aiConversation?.messages ?? [];

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setError(null);

    const requestId = crypto.randomUUID();
    setStreamingSegments([]);
    segmentsRef.current = [];
    setCompletedAnnouncement('');
    setStreamingRequestId(requestId);

    try {
      const result = await sendChatMessageStreaming({
        variables: { content: trimmed, requestId, conversationId: conversationId ?? undefined },
        // While a conversation is open, also refresh its own query so the new
        // messages show up without a manual refetch call.
        refetchQueries: conversationId
          ? [{ query: AI_CONVERSATIONS_QUERY }, { query: AI_CONVERSATION_QUERY, variables: { id: conversationId } }]
          : [{ query: AI_CONVERSATIONS_QUERY }],
      });

      const payload = result.data?.sendChatMessageStreaming;
      if (payload?.errors?.length) {
        setError(payload.errors[0].message);
        return;
      }

      setConversationId(payload.conversation.id);
      setInput('');
    } finally {
      // Announce the complete reply once, from the ref (not the possibly-
      // stale `streamingSegments` state this closure captured when the
      // send started) — see segmentsRef's own comment above.
      const finalSegments = segmentsRef.current;
      if (finalSegments.length > 0) {
        setCompletedAnnouncement(
          finalSegments
            .map((s) => (s.role === 'TOOL' ? `Action taken: ${s.text}` : s.text))
            .join(' '),
        );
      }
      // Either the real, final assistant message is now in the refetched
      // AI_CONVERSATION_QUERY data (success), or nothing was ever
      // persisted (error) — either way, the locally-accumulated streaming
      // bubble has nothing left to contribute and should stop rendering.
      setStreamingRequestId(null);
    }
  }

  return (
    <main id="main-content" className="mx-auto flex max-w-md flex-col rounded-sheet border border-border dark:border-border-dark bg-surface/40 dark:bg-surface-dark/40">
      <div className="flex items-center justify-between px-5 pt-6 pb-3">
        <h1 className="text-2xl font-medium text-text-primary dark:text-text-primary-dark">Chat</h1>
        {conversationId && (
          <button
            onClick={() => {
              setConversationId(null);
              setError(null);
            }}
            className="text-xs text-accent dark:text-accent-dark"
          >
            New chat
          </button>
        )}
      </div>

      {error && <p className="mx-4 mb-3 text-xs text-danger dark:text-danger-dark" role="alert">{error}</p>}

      {/* sr-only, batched-once announcement of a finished reply — see completedAnnouncement's own comment above. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {completedAnnouncement}
      </div>

      {conversationId ? (
        <div className="mx-4 mb-3 flex min-h-[300px] flex-col gap-2">
          {threadLoading && !messages.length && (
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">Loading…</p>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} role={m.role} content={m.content} />
          ))}
          {streamingRequestId &&
            (streamingSegments.length > 0 ? (
              streamingSegments.map((segment, i) => <MessageBubble key={i} role={segment.role} content={segment.text} />)
            ) : (
              <div className="flex justify-start" aria-live="polite">
                <div className="rounded-card border border-border bg-surface px-3 py-2 text-sm text-text-primary dark:border-border-dark dark:bg-surface-dark dark:text-text-primary-dark">
                  Thinking…
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="mx-4 mb-3 flex flex-col gap-2">
          {conversations.length > 0 && (
            <>
              <p className="text-xs text-text-secondary dark:text-text-secondary-dark">Previous chats</p>
              {conversations.map((c: { id: string; title?: string | null }) => (
                <button
                  key={c.id}
                  onClick={() => setConversationId(c.id)}
                  className="rounded-card bg-surface px-3 py-2.5 text-left text-sm text-text-primary hover:bg-border/40 dark:bg-surface-dark dark:text-text-primary-dark"
                >
                  {c.title || 'Untitled chat'}
                </button>
              ))}
            </>
          )}
          {conversations.length === 0 && (
            <div className="rounded-card border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-5">
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                Ask me anything about your day — I can see your real tasks, calendar, and check-ins. I can also add,
                complete, or reschedule a task when you ask.
              </p>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSend} className="mx-4 mb-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something…"
          aria-label="Message"
          disabled={sending}
          className="flex-1 rounded-control border border-border dark:border-border-dark bg-background dark:bg-background-dark px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-control bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>

      <div className="h-2" />
      <BottomNav />
    </main>
  );
}
