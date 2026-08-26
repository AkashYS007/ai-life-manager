import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ScheduleProposal {
  summary: string;
  changes: Array<{ taskId: string; proposedStart: string; reason: string }>;
}

// Tool-calling actions in Chat increment. A chat turn's `content` can no
// longer always be a plain string once tool use enters the picture — a
// past assistant turn that called a tool needs to carry its `tool_use`
// block(s) forward verbatim (Anthropic's API requires the exact assistant
// message that requested a tool to precede that tool's `tool_result`), and
// the very next message must be a `user`-role turn carrying nothing but
// `tool_result` block(s). Every *other* existing call site (proposeSchedule,
// sendMessage, and streamMessage's own plain-text callers) still only ever
// uses a plain string for `content` — this union is additive, not a
// breaking change to any of those.
export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicToolUse {
  id: string;
  name: string;
  input: unknown;
}

// AI cost telemetry increment (2026-08-25). Every method below now returns
// its call's real token counts alongside its actual result, so every caller
// can hand them straight to AiUsageService.record without re-parsing
// anything — the alternative (each caller re-reading a raw response body
// itself) would mean either exposing the raw fetch response outside this
// client (defeating the point of wrapping the API at all) or duplicating
// the same `body.usage` extraction four times. Non-streaming calls read
// this straight off Anthropic's response body (`body.usage`); streamMessage
// accumulates it from the `message_start`/`message_delta` SSE events — see
// that method's own comment for why it can't just read one field.
export interface AnthropicUsage {
  inputTokens: number;
  outputTokens: number;
}

// The three real actions Chat can now take on the person's behalf — see
// ChatService.executeTool for what each one actually does server-side once
// the model asks for it, and that same method's own comment for why the
// model deciding to call one of these is never trusted at face value.
// Deliberately not forced (no `tool_choice` override — see streamMessage's
// own comment) the way SCHEDULE_TOOL above is: a chat message is
// conversational by nature, so the model needs to be free to just answer in
// plain text most of the time and only reach for one of these when the
// person actually asked for something real to happen.
const CREATE_TASK_TOOL: AnthropicTool = {
  name: 'create_task',
  description: "Create a new task on the person's task list.",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short, clear task title.' },
      priority: {
        type: 'integer',
        description: '1 = urgent, 2 = high, 3 = normal, 4 = someday. Omit to use the default (3, normal).',
      },
      dueDate: {
        type: 'string',
        description: 'An ISO 8601 date (YYYY-MM-DD) if the person mentioned a deadline. Omit if none was mentioned.',
      },
    },
    required: ['title'],
  },
};

const COMPLETE_TASK_TOOL: AnthropicTool = {
  name: 'complete_task',
  description: "Mark one of the person's existing open tasks as completed.",
  input_schema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Must be one of the real task ids given in the "Open tasks" list in the prompt — never invent one.',
      },
    },
    required: ['taskId'],
  },
};

const RESCHEDULE_TASK_TOOL: AnthropicTool = {
  name: 'reschedule_task',
  description: "Move one of the person's existing open tasks to a new start time.",
  input_schema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Must be one of the real task ids given in the "Open tasks" list in the prompt — never invent one.',
      },
      // Same offset-less-local-wall-clock convention as SCHEDULE_TOOL's own
      // proposedStart field above, deliberately worded almost identically —
      // parseAiDateTime (planner.service.ts, now exported and reused here)
      // interprets it the same way regardless of which tool produced it.
      startTime: {
        type: 'string',
        description:
          'A plain local datetime in the timezone stated in the prompt, formatted exactly as YYYY-MM-DDTHH:mm:ss. Do NOT include a UTC offset or a trailing "Z"; this is a local wall-clock time, not a UTC instant.',
      },
    },
    required: ['taskId', 'startTime'],
  },
};

// Expanded tool set for Chat increment: four more real actions, each
// reusing a service ChatService already had injected before this increment
// (SignalsService, CalendarService, MemoryService) — no new module wiring
// needed, same "the model can now do what the app can already do, just
// reachable by asking" scope as the original three Task-focused tools.
const LOG_MOOD_CHECKIN_TOOL: AnthropicTool = {
  name: 'log_mood_checkin',
  description: "Log a mood check-in for right now. Only use this when the person actually states or clearly implies how they're feeling right now, not just discussing mood in the abstract.",
  input_schema: {
    type: 'object',
    properties: {
      moodScore: { type: 'integer', description: '1 (very low) to 5 (very good).' },
      note: { type: 'string', description: 'A short optional note about why, only if the person actually gave one.' },
    },
    required: ['moodScore'],
  },
};

const LOG_ENERGY_CHECKIN_TOOL: AnthropicTool = {
  name: 'log_energy_checkin',
  description: "Log an energy check-in for right now. Only use this when the person actually states or clearly implies their energy level right now.",
  input_schema: {
    type: 'object',
    properties: {
      energyScore: { type: 'integer', description: '1 (very low) to 5 (very high).' },
    },
    required: ['energyScore'],
  },
};

const CREATE_CALENDAR_EVENT_TOOL: AnthropicTool = {
  name: 'create_calendar_event',
  description: "Add a new event to the person's calendar.",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short, clear event title.' },
      // Same offset-less-local-wall-clock convention as reschedule_task's
      // own startTime field above — parseAiDateTime interprets both the
      // same way regardless of which tool produced them.
      startTime: {
        type: 'string',
        description:
          'A plain local datetime in the timezone stated in the prompt, formatted exactly as YYYY-MM-DDTHH:mm:ss. Do NOT include a UTC offset or a trailing "Z".',
      },
      endTime: {
        type: 'string',
        description: 'Same format as startTime. Must be later than startTime.',
      },
      description: { type: 'string', description: 'Optional extra detail about the event, only if the person actually gave any.' },
    },
    required: ['title', 'startTime', 'endTime'],
  },
};

const ADD_MEMORY_FACT_TOOL: AnthropicTool = {
  name: 'add_memory_fact',
  description:
    "Save something the person explicitly wants the AI to remember and factor into future answers (a preference, a standing instruction) — not a one-off task or a fact about their calendar/tasks, which have their own tools above.",
  input_schema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The fact/preference itself, phrased plainly (e.g. "Prefers no calls before 10am").' },
    },
    required: ['content'],
  },
};

export const CHAT_TOOLS: AnthropicTool[] = [
  CREATE_TASK_TOOL,
  COMPLETE_TASK_TOOL,
  RESCHEDULE_TASK_TOOL,
  LOG_MOOD_CHECKIN_TOOL,
  LOG_ENERGY_CHECKIN_TOOL,
  CREATE_CALENDAR_EVENT_TOOL,
  ADD_MEMORY_FACT_TOOL,
];

// Forcing tool use (rather than asking for prose or hoping for valid JSON
// in a text response) means Anthropic's API guarantees the shape of
// `input` matches this schema — no fragile response-parsing/regex, and no
// chance of the model wrapping its answer in explanatory text we'd have to
// strip. PlannerService still treats every field as untrusted input from
// here (§ its validateAndClamp step) — the tool schema guarantees shape,
// not that a taskId is real or a time slot is free.
const SCHEDULE_TOOL = {
  name: 'propose_schedule',
  description:
    "Propose start times for a subset of the given open tasks, fitting them into today's remaining free time.",
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'One or two sentences summarizing the plan and the reasoning behind it.',
      },
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'Must be one of the task ids provided in the prompt — never invent one.',
            },
            proposedStart: {
              type: 'string',
              // Deliberately asks for a plain local datetime with NO
              // timezone offset and NO trailing "Z" — bug fix: the prompt
              // states "now" in the person's local timezone, and this
              // field used to just say "ISO 8601 datetime" without saying
              // whether an offset was expected; when the model omitted
              // one, the server was parsing it as local-to-the-server-
              // process time instead of local-to-the-person time, silently
              // shifting the actual instant by however many hours
              // separated the two. planner.service.ts's parseAiDateTime
              // now interprets an offset-less string in the person's real
              // timezone regardless of what this description says (so a
              // model that ignores this instruction still works
              // correctly), but stating the expected format explicitly
              // here makes that the common case rather than something the
              // fallback parsing has to paper over.
              description:
                'A plain local datetime in the timezone stated in the prompt, formatted exactly as YYYY-MM-DDTHH:mm:ss — later today, after "now" in the prompt. Do NOT include a UTC offset or a trailing "Z"; this is a local wall-clock time, not a UTC instant.',
            },
            reason: {
              type: 'string',
              description: 'One short, specific sentence explaining this particular placement.',
            },
          },
          required: ['taskId', 'proposedStart', 'reason'],
        },
      },
    },
    required: ['summary', 'changes'],
  },
};

// Journal sentiment analysis increment. Forced single-tool-call shape,
// deliberately identical to SCHEDULE_TOOL above — the same reasoning
// applies: guaranteeing a numeric `score` field via Anthropic's own tool-use
// schema is simpler and more reliable than asking for a bare number in
// prose and hand-parsing the response. -1 to 1 (not 0 to 1, and not a
// 1-5 star scale) so "clearly negative," "mixed/neutral," and "clearly
// positive" each get a natural, symmetric range around 0 — the same range
// MemoryService.refreshJournalSentimentPattern's own trend thresholds
// below are written against.
const SENTIMENT_TOOL = {
  name: 'score_sentiment',
  description: "Score the emotional sentiment of a personal journal entry.",
  input_schema: {
    type: 'object',
    properties: {
      score: {
        type: 'number',
        description: '-1.0 (very negative) to 1.0 (very positive). 0 is neutral or mixed.',
      },
    },
    required: ['score'],
  },
};

// Anthropic's non-streaming Messages API always returns a top-level `usage`
// object; defensively defaulted to 0/0 rather than left `undefined` in the
// (never actually observed, but not contractually guaranteed) case it's
// ever missing — a usage-logging caller should get a real, addable number,
// not something that turns every downstream sum into NaN.
function extractUsage(body: { usage?: { input_tokens?: number; output_tokens?: number } }): AnthropicUsage {
  return {
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  };
}

@Injectable()
export class AnthropicClient {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get('ANTHROPIC_API_KEY');
  }

  // Journal sentiment analysis increment. Same forced-tool-call shape as
  // proposeSchedule above, just a much smaller schema and prompt — one
  // number, not a whole day's worth of task placements. The returned score
  // is clamped to [-1, 1] here rather than trusted at face value: a model
  // is free to ignore the schema's stated range in the number it actually
  // returns (the tool schema only guarantees the field is present and
  // numeric, not that it's in range), same "the tool schema guarantees
  // shape, not that the value is sane" caveat SCHEDULE_TOOL's own comment
  // already documents for proposeSchedule's callers.
  async analyzeSentiment(content: string): Promise<{ score: number; modelUsed: string; usage: AnthropicUsage }> {
    const model = this.config.get<string>('ANTHROPIC_MODEL')!;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.config.get<string>('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        tools: [SENTIMENT_TOOL],
        tool_choice: { type: 'tool', name: 'score_sentiment' },
        messages: [
          {
            role: 'user',
            content: `Score the emotional sentiment of this personal journal entry:\n\n${content}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API request failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as any;
    const toolUse = (body.content ?? []).find((block: any) => block.type === 'tool_use');
    if (!toolUse) {
      throw new Error('Anthropic response did not include the expected tool_use block');
    }

    const rawScore = Number((toolUse.input as { score: unknown }).score);
    const score = Number.isFinite(rawScore) ? Math.max(-1, Math.min(1, rawScore)) : 0;
    return { score, modelUsed: body.model ?? model, usage: extractUsage(body) };
  }

  async proposeSchedule(prompt: string): Promise<{ proposal: ScheduleProposal; modelUsed: string; usage: AnthropicUsage }> {
    const model = this.config.get<string>('ANTHROPIC_MODEL')!;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.config.get<string>('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        tools: [SCHEDULE_TOOL],
        tool_choice: { type: 'tool', name: 'propose_schedule' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API request failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as any;
    const toolUse = (body.content ?? []).find((block: any) => block.type === 'tool_use');
    if (!toolUse) {
      throw new Error('Anthropic response did not include the expected tool_use block');
    }

    return { proposal: toolUse.input as ScheduleProposal, modelUsed: body.model ?? model, usage: extractUsage(body) };
  }

  // Plain multi-turn text completion — the legacy, non-streaming path
  // behind the original sendChatMessage mutation, kept exactly as it was
  // (still text-only, no tools) since the Chat page itself no longer calls
  // it (see ChatPage's own comment) — see streamMessage below for the real,
  // tool-capable path everything actually in use goes through now.
  // `system` carries the grounding context (real tasks/calendar/signals,
  // built by ChatService), kept separate from the conversation history the
  // same way Anthropic's API itself separates a system prompt from turns.
  async sendMessage(
    messages: AnthropicMessage[],
    system: string,
  ): Promise<{ content: string; modelUsed: string; usage: AnthropicUsage }> {
    const model = this.config.get<string>('ANTHROPIC_MODEL')!;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.config.get<string>('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system,
        messages,
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API request failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as any;
    const textBlock = (body.content ?? []).find((block: any) => block.type === 'text');
    if (!textBlock) {
      throw new Error('Anthropic response did not include the expected text block');
    }

    return { content: textBlock.text as string, modelUsed: body.model ?? model, usage: extractUsage(body) };
  }

  // Real-time chat streaming increment, extended by Tool-calling actions in
  // Chat to also accept an optional `tools` array. Same request as
  // sendMessage above, just with `stream: true` — Anthropic's Messages API
  // then responds as a genuine `text/event-stream` (server-sent-events)
  // body instead of one complete JSON object, exactly the reason this needs
  // its own method rather than a flag on sendMessage: parsing incremental
  // SSE frames is a meaningfully different job from parsing one JSON
  // response. No `tool_choice` override when `tools` is given — deliberately
  // left as Anthropic's default ("auto"), so the model stays free to just
  // answer in plain text and only reach for a tool when it actually decides
  // to, the opposite of proposeSchedule's forced single-tool call above.
  //
  // `onDelta` is called once per real token/chunk of *text* as Anthropic
  // sends it — ChatService.sendMessageStreaming forwards each call straight
  // into a GraphQL subscription publish, so a person watching Chat sees the
  // reply grow in genuinely close to real time. A tool call's `input` also
  // streams incrementally (as partial JSON fragments, `input_json_delta`),
  // but that's accumulated and parsed internally here, never handed to
  // `onDelta` — a half-formed JSON fragment isn't something a person should
  // ever see typed out raw, and ChatService only ever needs the finished,
  // parsed `input` once a tool call is actually complete (see the returned
  // `toolUses` array). The full accumulated *text* is still returned at the
  // end in `content`, same as before this increment.
  async streamMessage(
    messages: AnthropicMessage[],
    system: string,
    onDelta: (text: string) => void,
    tools?: AnthropicTool[],
  ): Promise<{ content: string; modelUsed: string; toolUses: AnthropicToolUse[]; usage: AnthropicUsage }> {
    const model = this.config.get<string>('ANTHROPIC_MODEL')!;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.config.get<string>('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system,
        messages,
        stream: true,
        ...(tools && tools.length > 0 ? { tools } : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API request failed: ${res.status} ${await res.text()}`);
    }
    if (!res.body) {
      throw new Error('Anthropic streaming response had no body');
    }

    let accumulated = '';
    let modelUsed = model;
    // AI cost telemetry increment. Unlike a non-streaming response, usage
    // here arrives split across two different event types: `message_start`
    // carries the real `input_tokens` up front (the request side is known
    // the instant Anthropic starts responding), while `output_tokens` only
    // becomes final in `message_delta`, sent once generation actually
    // finishes — genuinely can't be known any earlier, since it's a count
    // of what the model is still in the middle of producing. Both default
    // to 0 so a response that (for whatever reason) omits a usage field
    // entirely still returns a real, addable number rather than undefined.
    let inputTokens = 0;
    let outputTokens = 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    // SSE frames are separated by a blank line; a frame that arrives split
    // across two network chunks is buffered here until a full frame (or
    // more) has actually arrived — never assume one `read()` call lines up
    // with one event, the same defensive framing any real SSE consumer
    // needs regardless of language/runtime.
    let buffer = '';

    // Per-content-block-index state, keyed the same way Anthropic's own
    // stream keys each block — a single response can contain several
    // blocks (e.g. a short lead-in text block, then one or more tool_use
    // blocks), each streamed independently and interleaved by index.
    const toolBlocks = new Map<number, { id: string; name: string; jsonBuffer: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? ''; // last element may be an incomplete frame — keep it for next time

      for (const frame of frames) {
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
        if (!dataLine) continue; // e.g. an `event: ping` frame with no data line, or a comment

        const event = JSON.parse(dataLine.slice('data: '.length));
        if (event.type === 'message_start') {
          modelUsed = event.message?.model ?? modelUsed;
          inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
          // Anthropic's own message_start.usage also carries a provisional
          // output_tokens (typically 1-2, before any real generation has
          // happened) — deliberately not read here; message_delta below
          // always arrives with the real, final count before message_stop,
          // so reading it there instead of overwriting a near-meaningless
          // early value here is strictly more accurate for no extra cost.
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage?.output_tokens ?? outputTokens;
        } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          toolBlocks.set(event.index, { id: event.content_block.id, name: event.content_block.name, jsonBuffer: '' });
        } else if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta') {
            const text = event.delta.text as string;
            accumulated += text;
            onDelta(text);
          } else if (event.delta?.type === 'input_json_delta') {
            const block = toolBlocks.get(event.index);
            if (block) block.jsonBuffer += event.delta.partial_json ?? '';
          }
        }
        // content_block_stop/message_stop/ping carry nothing this method
        // needs to react to mid-stream — a tool_use block's accumulated
        // JSON is only ever parsed once, below, after the loop finishes
        // (simpler and just as correct as parsing on that block's own
        // content_block_stop, since nothing reads toolBlocks until then
        // anyway).
      }
    }

    const toolUses: AnthropicToolUse[] = Array.from(toolBlocks.values()).map((block) => ({
      id: block.id,
      name: block.name,
      // An empty jsonBuffer (a tool with no arguments at all) is valid and
      // means "{}", not a parse error — every real CHAT_TOOLS schema above
      // requires at least one field, but this stays defensive regardless.
      input: JSON.parse(block.jsonBuffer || '{}'),
    }));

    return { content: accumulated, modelUsed, toolUses, usage: { inputTokens, outputTokens } };
  }
}
