import { Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { zonedDayBounds } from '../common/date/zoned-day';
import { TasksService } from '../tasks/tasks.service';
import { CalendarService } from '../calendar/calendar.service';
import { SignalsService } from '../signals/signals.service';
import { MemoryService } from '../memory/memory.service';
import { AnthropicClient, AnthropicContentBlock, AnthropicMessage, AnthropicToolUse, CHAT_TOOLS } from '../planner/anthropic-client';
import { parseAiDateTime, DEFAULT_TASK_DURATION_MINUTES } from '../planner/planner.service';
import { AiConversation } from './models/ai-conversation.model';
import { ChatMessageRole } from './models/chat-message.model';

const TITLE_MAX_LENGTH = 60;
const HISTORY_LIMIT = 20; // most recent messages sent as context — plenty for a coherent reply without an unbounded prompt
const CONVERSATION_LIST_LIMIT = 50;
// A hard ceiling on how many times one chat turn can call a tool and ask
// the model to continue — the same "don't trust unbounded model behavior"
// discipline CalendarService.findNextOpenSlot's own SLOT_SEARCH_MAX_DAYS
// ceiling already established. In practice a real reply almost always
// finishes in 1-2 rounds (answer, or one tool call plus a confirmation);
// this only ever matters if the model somehow kept requesting tools
// indefinitely, which sendMessageStreaming's own fallback handles
// gracefully rather than looping forever.
const MAX_TOOL_ROUNDS = 3;

function toTitle(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > TITLE_MAX_LENGTH ? `${trimmed.slice(0, TITLE_MAX_LENGTH - 1)}…` : trimmed;
}

// Same overlap test as planner.service.ts's own module-private `overlaps`
// helper — not imported from there (that one isn't exported, and a
// two-line pure function isn't worth adding cross-module coupling for) but
// kept byte-for-byte identical in behavior on purpose.
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
    private readonly calendarService: CalendarService,
    private readonly signalsService: SignalsService,
    private readonly memoryService: MemoryService,
    private readonly anthropic: AnthropicClient,
  ) {}

  isConfigured(): boolean {
    return this.anthropic.isConfigured();
  }

  private async requireOwnedConversation(userId: string, id: string) {
    const conversation = await this.prisma.aiConversation.findFirst({ where: { id, userId } });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  // Prisma's generated ChatMessageRole (a plain string union derived from
  // the schema enum) is not the same TypeScript type as the GraphQL model's
  // ChatMessageRole (a real TS enum) even though the runtime string values
  // match exactly — same class of mismatch as PlanRunDecision in
  // planner.service.ts, so every message is explicitly re-shaped here
  // rather than passed through, the same "service layer owns the storage
  // -> GraphQL translation" split used throughout this codebase.
  private async hydrate(conversationId: string): Promise<AiConversation> {
    const conversation = await this.prisma.aiConversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    return {
      id: conversation.id,
      title: conversation.title ?? undefined,
      startedAt: conversation.startedAt,
      lastMessageAt: conversation.lastMessageAt,
      messages: conversation.messages.map((m: any) => ({
        id: m.id,
        role: m.role as ChatMessageRole,
        content: m.content,
        createdAt: m.createdAt,
      })),
    };
  }

  async listForUser(userId: string): Promise<AiConversation[]> {
    const conversations = await this.prisma.aiConversation.findMany({
      where: { userId },
      orderBy: { lastMessageAt: 'desc' },
      take: CONVERSATION_LIST_LIMIT,
    });
    // List view intentionally doesn't hydrate messages (the client asking
    // for a conversation list is building a history sidebar, not reading
    // every message in every thread) — same "shape the response to the
    // actual access pattern" reasoning as TasksService.listOpenForUser vs.
    // the full listConnection.
    return conversations.map((c) => ({
      id: c.id,
      title: c.title ?? undefined,
      startedAt: c.startedAt,
      lastMessageAt: c.lastMessageAt,
      messages: [],
    }));
  }

  async getConversation(userId: string, id: string): Promise<AiConversation> {
    await this.requireOwnedConversation(userId, id);
    return this.hydrate(id);
  }

  // Builds the grounding context block (today's real tasks/calendar/
  // signals) the same way planner.service.ts's buildPrompt does for
  // schedule generation — the point of chat being useful is that its
  // answers are about *your* actual day, not generic advice.
  private async buildContext(userId: string, timezone: string): Promise<string> {
    const now = new Date();
    const { start: dayStart, end: dayEnd } = zonedDayBounds(now, timezone);

    const [openTasks, todaysEvents, todayMood, todayEnergy, lastNightSleep, memoryContext] = await Promise.all([
      this.tasksService.listOpenForUser(userId),
      this.calendarService.listInRange(userId, dayStart, dayEnd),
      this.signalsService.getTodayMood(userId, timezone),
      this.signalsService.getTodayEnergy(userId, timezone),
      this.signalsService.getLastNightSleep(userId, timezone),
      this.memoryService.buildContextBlock(userId),
    ]);

    const nowLocal = DateTime.fromJSDate(now, { zone: timezone });

    // Tool-calling actions in Chat increment: each open task now carries
    // its real id, in the exact same `- id=... | "title" | priority=N ...`
    // style planner.service.ts's buildPrompt already uses for the AI daily
    // planner's own task list — same reasoning, reused rather than
    // reinvented: complete_task/reschedule_task's own tool schemas tell the
    // model to copy an id verbatim from here, never invent one, and every
    // executeTool call re-validates that id server-side regardless (see
    // that method's own comment).
    const tasksList = openTasks.length
      ? openTasks
          .map((t) => {
            const due = t.dueDate ? `, due ${DateTime.fromJSDate(new Date(t.dueDate), { zone: timezone }).toISODate()}` : '';
            return `- id=${t.id} | "${t.title}" | priority=${t.priority} (1=urgent, 4=someday)${due}`;
          })
          .join('\n')
      : '(no open tasks)';

    const eventsList = todaysEvents.length
      ? todaysEvents
          .map((e) => {
            const s = DateTime.fromJSDate(new Date(e.startTime), { zone: timezone }).toFormat('HH:mm');
            const en = DateTime.fromJSDate(new Date(e.endTime), { zone: timezone }).toFormat('HH:mm');
            return `- ${s}-${en} "${e.title}"${e.isImmovable ? ' (fixed)' : ''}`;
          })
          .join('\n')
      : '(nothing on the calendar today)';

    const stateLines = [
      todayMood ? `Mood check-in today: ${todayMood.moodScore}/5` : 'Mood: not checked in today',
      todayEnergy ? `Energy check-in today: ${todayEnergy.energyScore}/5` : 'Energy: not checked in today',
      lastNightSleep?.durationMinutes
        ? `Last night's sleep: ${Math.round((lastNightSleep.durationMinutes / 60) * 10) / 10}h`
        : "Last night's sleep: not logged",
    ].join('\n');

    const memorySection = memoryContext
      ? `\nThings this person has told the AI to remember — treat these as true and factor them into your answers:\n${memoryContext}\n`
      : '';

    return `You are the AI assistant inside "AI Life Manager," a personal life-planning app. Answer the person's questions and give them practical, specific advice grounded in the real information below — don't invent tasks or events that aren't listed. Keep replies conversational and reasonably short unless they ask for more detail. You can now take real actions when the person actually asks for them, using the tools available to you: create a task, mark one of their existing open tasks complete, reschedule one of their existing open tasks to a new time, log a mood or energy check-in, add a new event to their calendar, or save something to remember for later. Only use a tool when they've actually asked for that action (don't create a task just because they mentioned something in passing, and don't log a mood check-in just because a mood came up in conversation — only when they're actually reporting how they feel right now), and only ever reference a real taskId from the "Open tasks" list below — never invent one. For anything else they ask you to do that isn't one of those actions, say plainly that you can't do that yet and suggest they do it directly in the app.

Current time: ${nowLocal.toFormat('HH:mm')} on ${nowLocal.toFormat('cccc, LLLL d')} (${timezone}).

Open tasks:
${tasksList}

Today's calendar:
${eventsList}

How they're doing right now:
${stateLines}
${memorySection}`;
  }

  // Shared by both sendMessage and sendMessageStreaming below — everything
  // that happens *before* the actual Anthropic call is identical either
  // way (find-or-create the conversation, persist the user's own message,
  // load recent history, build the grounding context block); the two
  // methods only ever differ in which AnthropicClient method they call and
  // how they handle the reply once it's back. Pulled out specifically for
  // the Real-time chat streaming increment, so streaming didn't mean
  // copy-pasting this whole setup a second time.
  private async prepareTurn(
    userId: string,
    timezone: string,
    content: string,
    conversationId?: string,
  ): Promise<{
    conversation: { id: string };
    messages: AnthropicMessage[];
    system: string;
  }> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('EMPTY_MESSAGE');
    }

    const conversation = conversationId
      ? await this.requireOwnedConversation(userId, conversationId)
      : await this.prisma.aiConversation.create({ data: { userId, title: toTitle(trimmed) } });

    await this.prisma.aiChatMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: trimmed },
    });

    const history = await this.prisma.aiChatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    const orderedHistory = history.reverse();

    const system = await this.buildContext(userId, timezone);
    // Tool-calling actions in Chat increment: a past TOOL row is now
    // genuinely possible (previously this filter's TOOL exclusion was
    // defensive/unused, since nothing ever wrote one). Rather than trying
    // to replay a past tool call's real tool_use/tool_result block pair
    // (fragile — it would mean reconstructing Anthropic's own internal
    // tool_use ids across separate top-level API calls, which nothing here
    // persists), a past TOOL row is folded into history as a plain
    // assistant-authored text note instead — simple, and good enough for
    // what it's actually for: letting a later "did that work?" follow-up
    // find real context about what already happened, not re-litigating the
    // original tool call itself.
    const messages: AnthropicMessage[] = orderedHistory
      .filter((m) => m.role === 'USER' || m.role === 'ASSISTANT' || m.role === 'TOOL')
      .map((m) => ({
        role: m.role === 'USER' ? 'user' : 'assistant',
        content: m.role === 'TOOL' ? `[Action taken: ${m.content}]` : m.content,
      }));

    return { conversation, messages, system };
  }

  private async persistMessage(
    conversationId: string,
    role: 'ASSISTANT' | 'TOOL',
    content: string,
    toolCalls?: unknown,
  ): Promise<void> {
    await this.prisma.aiChatMessage.create({
      data: { conversationId, role, content, ...(toolCalls !== undefined ? { toolCalls: toolCalls as any } : {}) },
    });
  }

  private async touchAndHydrate(conversationId: string): Promise<AiConversation> {
    await this.prisma.aiConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
    return this.hydrate(conversationId);
  }

  async sendMessage(
    userId: string,
    timezone: string,
    content: string,
    conversationId?: string,
  ): Promise<AiConversation> {
    const { conversation, messages, system } = await this.prepareTurn(userId, timezone, content, conversationId);
    const { content: replyContent } = await this.anthropic.sendMessage(messages, system);
    await this.persistMessage(conversation.id, 'ASSISTANT', replyContent);
    return this.touchAndHydrate(conversation.id);
  }

  // Tool-calling actions in Chat increment: executes one real action a
  // model just asked for, server-side, and reports back both a short,
  // person-facing summary (what TOOL role message gets persisted/streamed)
  // and a slightly more explicit result string fed back to the model
  // itself as this tool call's `tool_result`. Every field on `input` is
  // treated as untrusted — the tool schema (CHAT_TOOLS in anthropic-
  // client.ts) only guarantees shape, never that a taskId is real, a
  // priority is in range, or a time doesn't collide with something fixed —
  // the exact same "policy layer never trusts the model" discipline
  // PlannerService's own validateAndClamp step already established for the
  // AI daily planner. Never throws — every failure path (bad input, a
  // taskId that doesn't exist or belongs to someone else, a real calendar
  // conflict) comes back as a normal `isError: true` result the model can
  // read and react to (e.g. apologize and ask a clarifying question),
  // rather than crashing the whole turn.
  private async executeTool(
    userId: string,
    timezone: string,
    name: string,
    input: unknown,
  ): Promise<{ summary: string; resultForModel: string; isError: boolean }> {
    const args = (input ?? {}) as Record<string, unknown>;

    try {
      if (name === 'create_task') {
        const title = typeof args.title === 'string' ? args.title.trim() : '';
        if (!title) {
          const message = "Could not create the task: no title was given.";
          return { summary: message, resultForModel: message, isError: true };
        }

        let priority: number | undefined;
        if (args.priority !== undefined) {
          const parsed = Number(args.priority);
          if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
            const message = 'Could not create the task: priority must be a whole number from 1 (urgent) to 4 (someday).';
            return { summary: message, resultForModel: message, isError: true };
          }
          priority = parsed;
        }

        let dueDate: Date | undefined;
        if (typeof args.dueDate === 'string' && args.dueDate.trim()) {
          const parsed = DateTime.fromISO(args.dueDate.trim(), { zone: timezone });
          if (!parsed.isValid) {
            const message = `Could not create the task: "${args.dueDate}" isn't a valid date.`;
            return { summary: message, resultForModel: message, isError: true };
          }
          dueDate = parsed.toJSDate();
        }

        const task = await this.tasksService.create(userId, { title, priority, dueDate });
        const dueText = task.dueDate
          ? `, due ${DateTime.fromJSDate(new Date(task.dueDate), { zone: timezone }).toISODate()}`
          : '';
        const summary = `Added task: "${task.title}" (priority ${task.priority}${dueText})`;
        return { summary, resultForModel: `Created task ${task.id}: "${task.title}".`, isError: false };
      }

      if (name === 'complete_task') {
        const taskId = typeof args.taskId === 'string' ? args.taskId : '';
        if (!taskId) {
          const message = 'Could not complete the task: no taskId was given.';
          return { summary: message, resultForModel: message, isError: true };
        }
        const task = await this.tasksService.complete(userId, taskId);
        const summary = `Marked task complete: "${task.title}"`;
        return { summary, resultForModel: `Marked task ${task.id} ("${task.title}") as completed.`, isError: false };
      }

      if (name === 'reschedule_task') {
        const taskId = typeof args.taskId === 'string' ? args.taskId : '';
        const startTimeRaw = typeof args.startTime === 'string' ? args.startTime : '';
        if (!taskId || !startTimeRaw) {
          const message = 'Could not reschedule the task: taskId and startTime are both required.';
          return { summary: message, resultForModel: message, isError: true };
        }

        // Throws NotFoundException (caught below) if this id is bogus or
        // belongs to someone else — never trusted just because the model
        // said it came from the "Open tasks" list.
        const record = await this.tasksService.requireOwnedTask(userId, taskId);

        const start = parseAiDateTime(startTimeRaw, timezone);
        if (isNaN(start.getTime())) {
          const message = `Could not reschedule the task: "${startTimeRaw}" isn't a valid time.`;
          return { summary: message, resultForModel: message, isError: true };
        }

        const durationMinutes = record.estimatedDurationMinutes ?? DEFAULT_TASK_DURATION_MINUTES;
        const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

        // Same real-conflict standard PlannerService's own validateAndClamp
        // already holds the AI daily planner's own proposals to — a fixed
        // (isImmovable) calendar event is never silently double-booked,
        // whether the overlapping change came from the planner or from a
        // chat request.
        const eventsInWindow = await this.calendarService.listInRange(userId, start, end);
        const hasFixedConflict = eventsInWindow.some(
          (e) => e.isImmovable && overlaps(start, end, new Date(e.startTime), new Date(e.endTime)),
        );
        if (hasFixedConflict) {
          const message = `Could not reschedule "${record.title}" to that time: it overlaps a fixed event already on the calendar. Ask the person for a different time, or suggest one yourself based on their calendar.`;
          return { summary: `Couldn't reschedule "${record.title}" — that time overlaps a fixed calendar event.`, resultForModel: message, isError: true };
        }

        const task = await this.tasksService.applySchedule(userId, taskId, start, end);
        const startText = DateTime.fromJSDate(start, { zone: timezone }).toFormat("cccc, LLLL d 'at' HH:mm");
        const summary = `Rescheduled task: "${task.title}" to ${startText}`;
        return { summary, resultForModel: `Rescheduled task ${task.id} ("${task.title}") to ${startTimeRaw}.`, isError: false };
      }

      if (name === 'log_mood_checkin') {
        const parsed = Number(args.moodScore);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
          const message = 'Could not log that mood check-in: moodScore must be a whole number from 1 to 5.';
          return { summary: message, resultForModel: message, isError: true };
        }
        const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim().slice(0, 500) : undefined;
        await this.signalsService.logMood(userId, { moodScore: parsed, note });
        const summary = `Logged mood check-in: ${parsed}/5${note ? ` ("${note}")` : ''}`;
        return { summary, resultForModel: `Logged a mood check-in of ${parsed}/5.`, isError: false };
      }

      if (name === 'log_energy_checkin') {
        const parsed = Number(args.energyScore);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
          const message = 'Could not log that energy check-in: energyScore must be a whole number from 1 to 5.';
          return { summary: message, resultForModel: message, isError: true };
        }
        await this.signalsService.logEnergy(userId, { energyScore: parsed });
        const summary = `Logged energy check-in: ${parsed}/5`;
        return { summary, resultForModel: `Logged an energy check-in of ${parsed}/5.`, isError: false };
      }

      if (name === 'create_calendar_event') {
        const title = typeof args.title === 'string' ? args.title.trim() : '';
        const startTimeRaw = typeof args.startTime === 'string' ? args.startTime : '';
        const endTimeRaw = typeof args.endTime === 'string' ? args.endTime : '';
        if (!title || !startTimeRaw || !endTimeRaw) {
          const message = 'Could not create the event: title, startTime, and endTime are all required.';
          return { summary: message, resultForModel: message, isError: true };
        }

        const startTime = parseAiDateTime(startTimeRaw, timezone);
        const endTime = parseAiDateTime(endTimeRaw, timezone);
        if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
          const message = `Could not create the event: "${startTimeRaw}" or "${endTimeRaw}" isn't a valid time.`;
          return { summary: message, resultForModel: message, isError: true };
        }
        // calendarService.create itself does no ordering check — that lives
        // in CalendarResolver.createCalendarEvent, ahead of the service
        // call, for the public mutation. Calling the service directly here
        // (bypassing that resolver) means this exact same check has to be
        // repeated, or a chat-requested event could silently save with its
        // end before its start.
        if (endTime <= startTime) {
          const message = 'Could not create the event: the end time has to be after the start time.';
          return { summary: message, resultForModel: message, isError: true };
        }

        const description = typeof args.description === 'string' && args.description.trim() ? args.description.trim() : undefined;
        // No fixed-event conflict check here, deliberately — the plain
        // createCalendarEvent mutation a person's own manual "add an
        // event" already goes through has never checked for overlaps
        // either (see the Booking a workout as a real calendar block
        // entry's own note on this), so a chat-requested event is held to
        // the same standard, not a stricter one invented just for this path.
        const event = await this.calendarService.create(userId, { title, startTime, endTime, description });
        const startText = DateTime.fromJSDate(startTime, { zone: timezone }).toFormat("cccc, LLLL d 'at' HH:mm");
        const summary = `Added to calendar: "${event.title}" on ${startText}`;
        return { summary, resultForModel: `Created calendar event ${event.id}: "${event.title}".`, isError: false };
      }

      if (name === 'add_memory_fact') {
        const content = typeof args.content === 'string' ? args.content.trim() : '';
        if (!content) {
          const message = 'Could not save that — no content was given.';
          return { summary: message, resultForModel: message, isError: true };
        }
        if (content.length > 500) {
          const message = 'Could not save that: it needs to be 500 characters or fewer.';
          return { summary: message, resultForModel: message, isError: true };
        }
        const fact = await this.memoryService.create(userId, content);
        const summary = `Remembered: "${fact.content}"`;
        return { summary, resultForModel: `Saved a new memory fact: "${fact.content}".`, isError: false };
      }

      const message = `Unknown tool "${name}".`;
      return { summary: message, resultForModel: message, isError: true };
    } catch (error) {
      if (error instanceof NotFoundException) {
        const message = "Could not find that task — it may not exist, may have already changed, or belongs to someone else.";
        return { summary: message, resultForModel: message, isError: true };
      }
      const message = `Something went wrong performing that action: ${(error as Error).message}`;
      return { summary: message, resultForModel: message, isError: true };
    }
  }

  // The streaming, tool-capable counterpart to sendMessage — same
  // find-or-create/persist-the-user-message setup (prepareTurn), but now a
  // real loop: each round asks Anthropic for a reply, streams any real text
  // live via onEvent('ASSISTANT', ...), and — if the model asked to call
  // one or more tools — actually executes them, persists+streams a TOOL
  // event for each, and feeds the real result back so the model can
  // continue (apologize, confirm, ask a follow-up, or call another tool),
  // up to MAX_TOOL_ROUNDS. ChatResolver's chatStreamChunk subscription is
  // what onEvent actually publishes to — this service still has no idea a
  // subscription exists, same "service layer doesn't know about GraphQL"
  // separation as before this increment.
  async sendMessageStreaming(
    userId: string,
    timezone: string,
    content: string,
    conversationId: string | undefined,
    onEvent: (role: 'ASSISTANT' | 'TOOL', text: string) => void,
  ): Promise<AiConversation> {
    const { conversation, messages, system } = await this.prepareTurn(userId, timezone, content, conversationId);

    let working: AnthropicMessage[] = messages;
    let naturalStop = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { content: text, toolUses } = await this.anthropic.streamMessage(
        working,
        system,
        (delta) => onEvent('ASSISTANT', delta),
        CHAT_TOOLS,
      );

      if (text.trim()) {
        await this.persistMessage(conversation.id, 'ASSISTANT', text);
      }

      if (toolUses.length === 0) {
        naturalStop = true;
        if (!text.trim()) {
          // A genuinely empty response (no text, no tool call) — rare, but
          // the person still needs to see *something* rather than a
          // conversation that silently gained no reply at all.
          const fallback = "I didn't have anything to add there.";
          onEvent('ASSISTANT', fallback);
          await this.persistMessage(conversation.id, 'ASSISTANT', fallback);
        }
        break;
      }

      const toolResultBlocks: AnthropicContentBlock[] = [];
      for (const toolUse of toolUses as AnthropicToolUse[]) {
        const outcome = await this.executeTool(userId, timezone, toolUse.name, toolUse.input);
        await this.persistMessage(conversation.id, 'TOOL', outcome.summary, {
          name: toolUse.name,
          input: toolUse.input,
          result: outcome.resultForModel,
          isError: outcome.isError,
        });
        onEvent('TOOL', outcome.summary);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: outcome.resultForModel,
          is_error: outcome.isError,
        });
      }

      // Anthropic's own multi-turn tool protocol: the exact assistant turn
      // that requested the tool(s) has to be replayed back verbatim (its
      // text block, if any, plus every tool_use block), immediately
      // followed by one user-role turn carrying nothing but the matching
      // tool_result block(s) — only then can the model be asked to
      // continue into the next round.
      working = [
        ...working,
        {
          role: 'assistant',
          content: [
            ...(text.trim() ? [{ type: 'text' as const, text }] : []),
            ...toolUses.map((tu) => ({ type: 'tool_use' as const, id: tu.id, name: tu.name, input: tu.input })),
          ],
        },
        { role: 'user', content: toolResultBlocks },
      ];
    }

    if (!naturalStop) {
      // MAX_TOOL_ROUNDS was hit mid-loop (never observed in practice, but
      // never assumed impossible either) — the action(s) already taken are
      // real and already persisted above; this just makes sure the
      // conversation still ends on a real, visible confirmation instead of
      // trailing off after the last tool result with no reply at all.
      const note = "Done — I've made the change(s) above.";
      onEvent('ASSISTANT', note);
      await this.persistMessage(conversation.id, 'ASSISTANT', note);
    }

    return this.touchAndHydrate(conversation.id);
  }
}
