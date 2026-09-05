import { gql } from '@apollo/client';

// Matches the todayPlan query in the API Design Document §5.1, extended
// with real task data (Tasks increment) and real calendar event data
// (Calendar increment). `triggerEvent` (auto-plan indicator increment) has
// existed on AiPlanRun since the very first automatic re-planning
// increment, but nothing here ever asked for it — added so AiPlanCard can
// tell an auto-generated plan apart from a manually-requested one.
export const TODAY_PLAN_QUERY = gql`
  query TodayPlan {
    todayPlan {
      greeting
      tasksCount
      hasTasks
      hasEvents
      user {
        id
        displayName
        email
        subscription {
          tier
        }
      }
      tasks {
        id
        title
        status
        priority
        dueDate
        estimatedDurationMinutes
        goal {
          id
          title
        }
        subtasks {
          id
          status
        }
      }
      events {
        id
        title
        startTime
        endTime
        isImmovable
        source
      }
      todayMood {
        id
        moodScore
        note
      }
      todayEnergy {
        id
        energyScore
      }
      lastNightSleep {
        id
        durationMinutes
        qualityScore
      }
      habits {
        id
        title
        frequency
        daysOfWeek
        preferredTime
        protectedDurationMinutes
        todayCompleted
      }
      latestPlanRun {
        id
        status
        modelUsed
        generatedAt
        triggerEvent
        autoApplyAt
        diff {
          summary
          changes {
            id
            changeType
            previousStart
            proposedStart
            proposedEnd
            reason
            task {
              id
              title
              priority
              estimatedDurationMinutes
            }
          }
        }
      }
    }
  }
`;

export const CREATE_TASK = gql`
  mutation CreateTask($title: String!, $estimatedDurationMinutes: Int, $goalId: ID) {
    createTask(input: { title: $title, estimatedDurationMinutes: $estimatedDurationMinutes, goalId: $goalId }) {
      task {
        id
        title
        status
        priority
        dueDate
        estimatedDurationMinutes
        goal {
          id
          title
        }
      }
      errors {
        code
        message
      }
    }
  }
`;

// Subtask UI increment: Task.parentTaskId has been a real, working
// CreateTaskInput field since the very first Tasks increment (see
// create-task.input.ts), but nothing on the frontend ever set it until now.
// A separate mutation from CREATE_TASK above rather than reusing it with an
// extra variable — QuickAddTask's call site has no reason to ever pass a
// parentTaskId, and keeping this one narrow (just the two fields a subtask
// actually needs) matches CREATE_TAG/other single-purpose mutations already
// in this file.
export const CREATE_SUBTASK = gql`
  mutation CreateSubtask($title: String!, $parentTaskId: ID!) {
    createTask(input: { title: $title, parentTaskId: $parentTaskId }) {
      task {
        id
        title
        status
      }
      errors {
        code
        message
      }
    }
  }
`;

// Editing a task's own details increment: was already a real, working
// backend mutation (UpdateTaskInput/tasks.resolver.ts) with no frontend
// query for it at all until now — used from AiPlanCard/WeeklyPlanCard's new
// "Edit task" control (see PlanChange.task's now-wider selection set below)
// so a task's title/priority/duration can be fixed without leaving the plan
// review card.
export const UPDATE_TASK = gql`
  mutation UpdateTask($id: ID!, $input: UpdateTaskInput!) {
    updateTask(id: $id, input: $input) {
      task {
        id
        title
        priority
        estimatedDurationMinutes
      }
      errors {
        code
        message
      }
    }
  }
`;

export const COMPLETE_TASK = gql`
  mutation CompleteTask($id: ID!, $actualDurationMinutes: Int) {
    completeTask(id: $id, actualDurationMinutes: $actualDurationMinutes) {
      task {
        id
        status
      }
      errors {
        code
        message
      }
    }
  }
`;

// Focus sessions feed task duration back increment — a plain Query, same
// "no side effects, safe to call freely" reasoning as ESTIMATE_TASK_DURATION
// just below. Returns null (not 0) when the task has no completed focus
// sessions, so the caller can tell "nothing to suggest" apart from a real
// zero.
export const FOCUSED_MINUTES_FOR_TASK = gql`
  query FocusedMinutesForTask($taskId: ID!) {
    focusedMinutesForTask(taskId: $taskId)
  }
`;

// Task duration estimation increment — a plain Query (no mutation, nothing
// written) so the frontend can call it freely to prefill a field without
// worrying about side effects.
export const ESTIMATE_TASK_DURATION = gql`
  query EstimateTaskDuration($title: String!, $description: String) {
    estimateTaskDuration(title: $title, description: $description)
  }
`;

// Calendar feature increment (Database Design Document §4.3 / API Design
// Document §3). `calendarEventsInRange` powers the day view; the Today
// screen gets its events from `todayPlan.events` above instead.
export const CALENDAR_EVENTS_IN_RANGE = gql`
  query CalendarEventsInRange($start: DateTime!, $end: DateTime!) {
    calendarEventsInRange(start: $start, end: $end) {
      id
      title
      description
      startTime
      endTime
      isImmovable
      source
    }
  }
`;

export const CREATE_CALENDAR_EVENT = gql`
  mutation CreateCalendarEvent($title: String!, $startTime: DateTime!, $endTime: DateTime!) {
    createCalendarEvent(input: { title: $title, startTime: $startTime, endTime: $endTime }) {
      event {
        id
        title
        startTime
        endTime
        isImmovable
        source
      }
      errors {
        field
        code
        message
      }
    }
  }
`;

// Push-edits-back increment: `updateCalendarEvent` itself has been a real,
// working backend mutation since the very first Calendar increment, but
// nothing on the frontend ever called it — this app never had an editor
// for a calendar event's own title/time at all until now. For a synced
// (Google/Microsoft) event, the resolver now pushes this same edit to the
// real provider first (see CalendarService.update's own comment) — from
// this mutation's own point of view there's no difference in shape between
// editing a native event and a synced one, same "one button, works for
// every source" precedent DELETE_CALENDAR_EVENT already set.
export const UPDATE_CALENDAR_EVENT = gql`
  mutation UpdateCalendarEvent($id: ID!, $input: UpdateCalendarEventInput!) {
    updateCalendarEvent(id: $id, input: $input) {
      event {
        id
        title
        startTime
        endTime
        isImmovable
        source
      }
      errors {
        field
        code
        message
      }
    }
  }
`;

export const DELETE_CALENDAR_EVENT = gql`
  mutation DeleteCalendarEvent($id: ID!) {
    deleteCalendarEvent(id: $id) {
      deletedEventId
      errors {
        code
        message
      }
    }
  }
`;

// Google Calendar sync (pull-only increment).
export const GOOGLE_CALENDAR_ACCOUNT = gql`
  query GoogleCalendarAccount {
    googleCalendarAccount {
      id
      provider
      externalAccountEmail
      status
      lastSyncedAt
      realtimeSyncEnabled
    }
  }
`;

export const START_GOOGLE_CALENDAR_CONNECTION = gql`
  mutation StartGoogleCalendarConnection($returnTo: String) {
    startGoogleCalendarConnection(returnTo: $returnTo) {
      authUrl
      errors {
        code
        message
      }
    }
  }
`;

export const DISCONNECT_GOOGLE_CALENDAR = gql`
  mutation DisconnectGoogleCalendar {
    disconnectGoogleCalendar {
      disconnected
      errors {
        code
        message
      }
    }
  }
`;

export const SYNC_GOOGLE_CALENDAR_NOW = gql`
  mutation SyncGoogleCalendarNow {
    syncGoogleCalendarNow {
      account {
        id
        lastSyncedAt
        realtimeSyncEnabled
      }
      syncedEventCount
      errors {
        code
        message
      }
    }
  }
`;

// Microsoft (Outlook/365) calendar sync — pull-only, mirrors the Google
// operations above exactly.
export const MICROSOFT_CALENDAR_ACCOUNT = gql`
  query MicrosoftCalendarAccount {
    microsoftCalendarAccount {
      id
      provider
      externalAccountEmail
      status
      lastSyncedAt
      realtimeSyncEnabled
    }
  }
`;

export const START_MICROSOFT_CALENDAR_CONNECTION = gql`
  mutation StartMicrosoftCalendarConnection($returnTo: String) {
    startMicrosoftCalendarConnection(returnTo: $returnTo) {
      authUrl
      errors {
        code
        message
      }
    }
  }
`;

export const DISCONNECT_MICROSOFT_CALENDAR = gql`
  mutation DisconnectMicrosoftCalendar {
    disconnectMicrosoftCalendar {
      disconnected
      errors {
        code
        message
      }
    }
  }
`;

export const SYNC_MICROSOFT_CALENDAR_NOW = gql`
  mutation SyncMicrosoftCalendarNow {
    syncMicrosoftCalendarNow {
      account {
        id
        lastSyncedAt
        realtimeSyncEnabled
      }
      syncedEventCount
      errors {
        code
        message
      }
    }
  }
`;

// Apple (CalDAV) calendar sync. No START_APPLE_CALENDAR_CONNECTION query —
// unlike Google/Microsoft's OAuth redirect, connecting is a direct
// appleId + app-specific password form submission, so CONNECT_APPLE_CALENDAR
// both connects and returns the resulting account in one call.
export const APPLE_CALENDAR_ACCOUNT = gql`
  query AppleCalendarAccount {
    appleCalendarAccount {
      id
      provider
      externalAccountEmail
      status
      lastSyncedAt
    }
  }
`;

export const CONNECT_APPLE_CALENDAR = gql`
  mutation ConnectAppleCalendar($input: ConnectAppleCalendarInput!) {
    connectAppleCalendar(input: $input) {
      account {
        id
        externalAccountEmail
      }
      errors {
        code
        message
      }
    }
  }
`;

export const DISCONNECT_APPLE_CALENDAR = gql`
  mutation DisconnectAppleCalendar {
    disconnectAppleCalendar {
      disconnected
      errors {
        code
        message
      }
    }
  }
`;

export const SYNC_APPLE_CALENDAR_NOW = gql`
  mutation SyncAppleCalendarNow {
    syncAppleCalendarNow {
      account {
        id
        lastSyncedAt
      }
      syncedEventCount
      errors {
        code
        message
      }
    }
  }
`;

// Signal tracking increment (Database Design Document §4.5) — mood, energy,
// sleep. All three log mutations refetch TODAY_PLAN_QUERY so the Today
// screen's check-in widgets flip to their "already logged" state instantly.
export const LOG_MOOD = gql`
  mutation LogMood($moodScore: Int!) {
    logMood(input: { moodScore: $moodScore }) {
      moodEntry {
        id
        moodScore
      }
      errors {
        code
        message
      }
    }
  }
`;

export const LOG_ENERGY = gql`
  mutation LogEnergy($energyScore: Int!) {
    logEnergy(input: { energyScore: $energyScore }) {
      energyEntry {
        id
        energyScore
      }
      errors {
        code
        message
      }
    }
  }
`;

export const LOG_SLEEP = gql`
  mutation LogSleep($durationMinutes: Int, $qualityScore: Int) {
    logSleep(input: { durationMinutes: $durationMinutes, qualityScore: $qualityScore }) {
      sleepEntry {
        id
        durationMinutes
        qualityScore
      }
      errors {
        code
        message
      }
    }
  }
`;

// AI daily planning increment (Database Design Document §4.6 / API Design
// Document §4.4). requestReplan sends open tasks + today's events + signals
// to the model and returns a proposed plan; respondToPlanRun accepts
// (writing real scheduledStart/scheduledEnd onto tasks) or rejects it.
export const REQUEST_REPLAN = gql`
  mutation RequestReplan {
    requestReplan {
      planRun {
        id
        status
        modelUsed
        generatedAt
        diff {
          summary
          changes {
            id
            changeType
            previousStart
            proposedStart
            proposedEnd
            reason
            task {
              id
              title
              priority
              estimatedDurationMinutes
            }
          }
        }
      }
      errors {
        code
        message
      }
    }
  }
`;

// Weekly/monthly AI plan generation increment — reuses requestReplan and
// respondToPlanRun (below), just parameterized by $scope, which defaults to
// DAY server-side when omitted (REQUEST_REPLAN above never passes it, so
// AiPlanCard's daily flow is completely untouched by this addition).
// Bug fix (found while building free-form plan editing): this selection set
// never asked for \`changes { id }\` at all — every change came back with
// \`id: undefined\`. WeeklyPlanCard keys its per-change local edit state
// (pendingEdits, editingChangeId) by change.id, so every row's local state
// collided under the same "undefined" key: editing one task's time visibly
// affected every row's editor at once, and Save & apply changes sent
// changeId: "undefined" to the server for all of them, which never matched
// anything real (see PlannerService.respondToPlanRun's editsByChangeId
// lookup), so no WEEK/MONTH edit could ever actually apply. REQUEST_REPLAN_
// SCOPED and RESPOND_TO_PLAN_RUN below already asked for \`id\` correctly —
// this was the one query in the Editing a proposed AI plan increment that
// got missed.
export const LATEST_PLAN_RUN_QUERY = gql`
  query LatestPlanRun($scope: PlanScope) {
    latestPlanRun(scope: $scope) {
      id
      status
      scope
      modelUsed
      generatedAt
      triggerEvent
      autoApplyAt
      diff {
        summary
        changes {
          id
          changeType
          previousStart
          proposedStart
          proposedEnd
          reason
          task {
            id
            title
            priority
            estimatedDurationMinutes
          }
        }
      }
    }
  }
`;

export const REQUEST_REPLAN_SCOPED = gql`
  mutation RequestReplanScoped($scope: PlanScope) {
    requestReplan(scope: $scope) {
      planRun {
        id
        status
        scope
        modelUsed
        generatedAt
        diff {
          summary
          changes {
            id
            changeType
            previousStart
            proposedStart
            proposedEnd
            reason
            task {
              id
              title
              priority
              estimatedDurationMinutes
            }
          }
        }
      }
      errors {
        code
        message
      }
    }
  }
`;

// Editing a proposed AI plan increment: $edits is only meaningful when
// $decision is EDIT (ACCEPT/REJECT both ignore it server-side, see
// planner.resolver.ts), so every existing ACCEPT/REJECT call site can keep
// omitting it entirely — GraphQL treats an omitted nullable list argument
// exactly like passing null. The response now also asks for the updated
// diff back (previously just id/status), since an EDIT decision can change
// what's actually in it — the applied times, or which changes survived at
// all — and the UI needs to show what was actually saved, not what was
// originally proposed.
// Free-form plan editing increment: $adds is the same "only meaningful with
// EDIT" story as $edits — a list of tasks the AI never proposed at all that
// the person is placing onto the plan themselves (see PlanChangeAddInput).
export const RESPOND_TO_PLAN_RUN = gql`
  mutation RespondToPlanRun(
    $id: ID!
    $decision: PlanRunDecision!
    $edits: [PlanChangeEditInput!]
    $adds: [PlanChangeAddInput!]
  ) {
    respondToPlanRun(id: $id, decision: $decision, edits: $edits, adds: $adds) {
      planRun {
        id
        status
        diff {
          summary
          changes {
            id
            changeType
            previousStart
            proposedStart
            proposedEnd
            reason
            task {
              id
              title
              priority
              estimatedDurationMinutes
            }
          }
        }
      }
      errors {
        code
        message
      }
    }
  }
`;

// Habits increment (Database Design Document §4.4 / API Design Document
// §6.2). Started as "Simple patterns first" (daily, or specific days of the
// week) — the Full custom habit recurrence increment adds every N days,
// every N weeks, monthly on a day-of-month, and monthly on the Nth (or
// last) weekday. See rrule.ts's own comment on the backend for the exact
// six shapes this covers.
// Linking habits to goals increment: `goal` added here, covering the list
// query and the create mutation's return payload in one place.
const HABIT_FIELDS = `
  id
  title
  frequency
  daysOfWeek
  intervalDays
  intervalWeeks
  monthlyMode
  dayOfMonth
  monthlyWeekday
  monthlyOrdinal
  daysOfMonth
  monthlyWeekdaySet
  intervalMonths
  count
  until
  preferredTime
  protectedDurationMinutes
  active
  todayCompleted
  goal {
    id
    title
  }
`;

export const HABITS_QUERY = gql`
  query Habits($activeOnly: Boolean) {
    habits(activeOnly: $activeOnly) {
      ${HABIT_FIELDS}
    }
  }
`;

export const CREATE_HABIT = gql`
  mutation CreateHabit(
    $title: String!
    $frequency: HabitFrequency!
    $daysOfWeek: [Int!]
    $intervalDays: Int
    $intervalWeeks: Int
    $monthlyMode: MonthlyRecurrenceMode
    $dayOfMonth: Int
    $monthlyWeekday: Int
    $monthlyOrdinal: Int
    $daysOfMonth: [Int!]
    $monthlyWeekdaySet: [Int!]
    $intervalMonths: Int
    $count: Int
    $until: String
    $preferredTime: String
    $protectedDurationMinutes: Int
    $goalId: ID
  ) {
    createHabit(
      input: {
        title: $title
        frequency: $frequency
        daysOfWeek: $daysOfWeek
        intervalDays: $intervalDays
        intervalWeeks: $intervalWeeks
        monthlyMode: $monthlyMode
        dayOfMonth: $dayOfMonth
        monthlyWeekday: $monthlyWeekday
        monthlyOrdinal: $monthlyOrdinal
        daysOfMonth: $daysOfMonth
        monthlyWeekdaySet: $monthlyWeekdaySet
        intervalMonths: $intervalMonths
        count: $count
        until: $until
        preferredTime: $preferredTime
        protectedDurationMinutes: $protectedDurationMinutes
        goalId: $goalId
      }
    ) {
      habit {
        ${HABIT_FIELDS}
      }
      errors {
        field
        code
        message
      }
    }
  }
`;

export const DEACTIVATE_HABIT = gql`
  mutation DeactivateHabit($id: ID!) {
    deactivateHabit(id: $id) {
      habit {
        ${HABIT_FIELDS}
      }
      errors {
        code
        message
      }
    }
  }
`;

// Habit-edit UI increment.
export const REACTIVATE_HABIT = gql`
  mutation ReactivateHabit($id: ID!) {
    reactivateHabit(id: $id) {
      habit {
        ${HABIT_FIELDS}
      }
      errors {
        code
        message
      }
    }
  }
`;

export const UPDATE_HABIT = gql`
  mutation UpdateHabit(
    $id: ID!
    $title: String
    $frequency: HabitFrequency
    $daysOfWeek: [Int!]
    $intervalDays: Int
    $intervalWeeks: Int
    $monthlyMode: MonthlyRecurrenceMode
    $dayOfMonth: Int
    $monthlyWeekday: Int
    $monthlyOrdinal: Int
    $daysOfMonth: [Int!]
    $monthlyWeekdaySet: [Int!]
    $intervalMonths: Int
    $count: Int
    $until: String
    $preferredTime: String
    $protectedDurationMinutes: Int
    $goalId: ID
  ) {
    updateHabit(
      id: $id
      input: {
        title: $title
        frequency: $frequency
        daysOfWeek: $daysOfWeek
        intervalDays: $intervalDays
        intervalWeeks: $intervalWeeks
        monthlyMode: $monthlyMode
        dayOfMonth: $dayOfMonth
        monthlyWeekday: $monthlyWeekday
        monthlyOrdinal: $monthlyOrdinal
        daysOfMonth: $daysOfMonth
        monthlyWeekdaySet: $monthlyWeekdaySet
        intervalMonths: $intervalMonths
        count: $count
        until: $until
        preferredTime: $preferredTime
        protectedDurationMinutes: $protectedDurationMinutes
        goalId: $goalId
      }
    ) {
      habit {
        ${HABIT_FIELDS}
      }
      errors {
        field
        code
        message
      }
    }
  }
`;

export const COMPLETE_HABIT_LOG = gql`
  mutation CompleteHabitLog($habitId: ID!, $date: DateTime!) {
    completeHabitLog(habitId: $habitId, date: $date) {
      habit {
        id
        todayCompleted
      }
      errors {
        code
        message
      }
    }
  }
`;

export const UNCOMPLETE_HABIT_LOG = gql`
  mutation UncompleteHabitLog($habitId: ID!, $date: DateTime!) {
    uncompleteHabitLog(habitId: $habitId, date: $date) {
      habit {
        id
        todayCompleted
      }
      errors {
        code
        message
      }
    }
  }
`;

// Chat increment (Database Design Document §4.6 / API Design Document
// §4.4). "Simple Q&A first" scope: a plain request/reply mutation, no
// real-time streaming subscription yet, and the AI can only talk — no
// tool-calling actions from inside the conversation.
export const AI_CONVERSATIONS_QUERY = gql`
  query AiConversations {
    aiConversations {
      id
      title
      startedAt
      lastMessageAt
    }
  }
`;

export const AI_CONVERSATION_QUERY = gql`
  query AiConversation($id: ID!) {
    aiConversation(id: $id) {
      id
      title
      startedAt
      lastMessageAt
      messages {
        id
        role
        content
        createdAt
      }
    }
  }
`;

// Real-time chat streaming increment. sendChatMessageStreaming mirrors
// sendChatMessage's exact shape (same errors, same final conversation
// object) plus the one new $requestId argument used to correlate this
// call with the chatStreamChunk subscription below — see
// apps/backend/src/chat/models/chat-stream-chunk.model.ts's own comment
// for why that's a client-generated id rather than the conversation's own.
export const SEND_CHAT_MESSAGE_STREAMING = gql`
  mutation SendChatMessageStreaming($content: String!, $requestId: String!, $conversationId: ID) {
    sendChatMessageStreaming(content: $content, requestId: $requestId, conversationId: $conversationId) {
      conversation {
        id
        title
        startedAt
        lastMessageAt
        messages {
          id
          role
          content
          createdAt
        }
      }
      errors {
        code
        message
      }
    }
  }
`;

export const CHAT_STREAM_CHUNK_SUBSCRIPTION = gql`
  subscription ChatStreamChunk($requestId: String!) {
    chatStreamChunk(requestId: $requestId) {
      requestId
      role
      delta
      done
    }
  }
`;

export const SEND_CHAT_MESSAGE = gql`
  mutation SendChatMessage($content: String!, $conversationId: ID) {
    sendChatMessage(content: $content, conversationId: $conversationId) {
      conversation {
        id
        title
        startedAt
        lastMessageAt
        messages {
          id
          role
          content
          createdAt
        }
      }
      errors {
        code
        message
      }
    }
  }
`;

// AI Memory increment (Database Design Document §4.6 / PRD §9). "Manual
// memory first" scope: the person directly tells the AI things to
// remember; both the AI planner and chat use these as real prompt context.
export const MEMORY_FACTS_QUERY = gql`
  query MemoryFacts {
    memoryFacts {
      id
      content
      confidence
      updatedAt
    }
  }
`;

export const CREATE_MEMORY_FACT = gql`
  mutation CreateMemoryFact($content: String!) {
    createMemoryFact(input: { content: $content }) {
      fact {
        id
        content
        confidence
        updatedAt
      }
      errors {
        code
        message
      }
    }
  }
`;

export const UPDATE_MEMORY_FACT = gql`
  mutation UpdateMemoryFact($id: ID!, $content: String!) {
    updateMemoryFact(id: $id, input: { content: $content }) {
      fact {
        id
        content
      }
      errors {
        code
        message
      }
    }
  }
`;

export const DELETE_MEMORY_FACT = gql`
  mutation DeleteMemoryFact($id: ID!) {
    deleteMemoryFact(id: $id) {
      deletedFactId
      errors {
        code
        message
      }
    }
  }
`;

// Timezone auto-sync (see components/TimezoneSync.tsx): every "today"/"now"
// calculation on the backend (Habits, Signals, the AI planner, Chat) reads
// user.timezone, which defaults to "UTC" for a brand-new account — these two
// operations let the client detect the browser's real IANA timezone once and
// write it back. Visible settings screen increment: `timezoneManual` is
// checked by TimezoneSync.tsx before it does that silent write at all — once
// someone has explicitly saved a timezone from /settings, this silent path
// backs off rather than overwriting their manual choice on the next load.
export const ME_TIMEZONE_QUERY = gql`
  query MeTimezone {
    me {
      id
      timezone
      timezoneManual
    }
  }
`;

export const UPDATE_PROFILE_TIMEZONE = gql`
  mutation UpdateProfileTimezone($timezone: String!) {
    updateProfile(input: { timezone: $timezone }) {
      user {
        id
        timezone
      }
      errors {
        code
        message
      }
    }
  }
`;

// Visible settings screen increment — the three onboarding-only answers
// (timezone override, chronotype, work hours) finally get a real screen.
// `updateProfile` already covered chronotype/timezone; `timezoneManual` and
// `workHoursStart`/`workHoursEnd` are new on this same mutation (see
// UpdateProfileInput) rather than a separate one, since this is still just
// "change something about my profile."
export const SETTINGS_QUERY = gql`
  query Settings {
    me {
      id
      email
      displayName
      timezone
      timezoneManual
      chronotype
      workHoursStart
      workHoursEnd
      pomodoroWorkMinutes
      pomodoroShortBreakMinutes
      pomodoroLongBreakMinutes
      pomodoroCyclesBeforeLongBreak
      reminderMorningRoutineHour
      reminderEveningRoutineHour
      reminderReflectionHour
      reminderHabitMinOverdueMinutes
      reminderHabitMaxOverdueMinutes
      reflectionWentWellLabel
      reflectionChallengingLabel
      reflectionCarryForwardLabel
      subscription {
        tier
        status
        currentPeriodEnd
        hasStripeCustomer
      }
    }
  }
`;

export const UPDATE_SETTINGS = gql`
  mutation UpdateSettings($input: UpdateProfileInput!) {
    updateProfile(input: $input) {
      user {
        id
        displayName
        timezone
        timezoneManual
        chronotype
        workHoursStart
        workHoursEnd
        pomodoroWorkMinutes
        pomodoroShortBreakMinutes
        pomodoroLongBreakMinutes
        pomodoroCyclesBeforeLongBreak
        reminderMorningRoutineHour
        reminderEveningRoutineHour
        reminderReflectionHour
        reminderHabitMinOverdueMinutes
        reminderHabitMaxOverdueMinutes
        reflectionWentWellLabel
        reflectionChallengingLabel
        reflectionCarryForwardLabel
      }
      errors {
        field
        code
        message
      }
    }
  }
`;

// Configurable Pomodoro durations increment — a small, focused query
// (rather than reusing SETTINGS_QUERY wholesale) so /focus only ever fetches
// the four fields it actually needs, not the whole settings screen's worth
// of profile/subscription data.
export const POMODORO_SETTINGS_QUERY = gql`
  query PomodoroSettings {
    me {
      id
      pomodoroWorkMinutes
      pomodoroShortBreakMinutes
      pomodoroLongBreakMinutes
      pomodoroCyclesBeforeLongBreak
    }
  }
`;

// Real billing/subscription management increment — see UsersService.
// changeSubscriptionTier's own comment for why this is a real state
// change with no real payment behind it. `subscription` is fetched back
// so the Plan picker's own local "which tier is highlighted" state can
// update from the mutation result directly, without waiting on
// SETTINGS_QUERY's refetch to land first.
export const CHANGE_SUBSCRIPTION_TIER = gql`
  mutation ChangeSubscriptionTier($tier: SubscriptionTier!) {
    changeSubscriptionTier(tier: $tier) {
      user {
        id
        subscription {
          tier
          status
          currentPeriodEnd
        }
      }
      errors {
        code
        message
      }
    }
  }
`;

// Real Stripe billing integration. Redirect-to-Stripe's-own-hosted-page
// mutations, mirroring START_GOOGLE_CALENDAR_CONNECTION's own
// `authUrl`-then-`window.location.href` shape exactly (see
// GoogleCalendarConnect.tsx). If Stripe isn't configured server-side, the
// resolver reports STRIPE_NOT_CONFIGURED and Settings falls back to the
// old CHANGE_SUBSCRIPTION_TIER simulated switch above.
export const CREATE_CHECKOUT_SESSION = gql`
  mutation CreateCheckoutSession($tier: SubscriptionTier!) {
    createCheckoutSession(tier: $tier) {
      checkoutUrl
      errors {
        code
        message
      }
    }
  }
`;

export const CREATE_BILLING_PORTAL_SESSION = gql`
  mutation CreateBillingPortalSession {
    createBillingPortalSession {
      portalUrl
      errors {
        code
        message
      }
    }
  }
`;

// Account deletion increment. No input — see users.resolver.ts's own note
// on why confirmation is a UI concern, not an API one.
export const DELETE_ACCOUNT = gql`
  mutation DeleteAccount {
    deleteAccount {
      deleted
      errors {
        code
        message
      }
    }
  }
`;

// Completed-tasks view (the "More" nav link). Reuses the existing
// cursor-paginated `tasks` root query (already built and e2e-tested in the
// Tasks increment) with status: COMPLETED — no new backend code needed,
// this was a real gap on the frontend only.
export const COMPLETED_TASKS_QUERY = gql`
  query CompletedTasks($after: String) {
    tasks(status: COMPLETED, first: 20, after: $after) {
      edges {
        cursor
        node {
          id
          title
          completedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Un-completing a task increment: the undo action on the completed-tasks
// view. refetchQueries at the call site includes both this list (the task
// should disappear from here) and TODAY_PLAN_QUERY (it should reappear on
// Today, same as any other open task) — see MorePage.
export const REOPEN_TASK = gql`
  mutation ReopenTask($id: ID!) {
    reopenTask(id: $id) {
      task {
        id
        status
      }
      errors {
        code
        message
      }
    }
  }
`;

// Focus sessions / Pomodoro timer. activeFocusSession lets the /focus page
// resume an in-progress countdown after a reload (see FocusService.getActive);
// recentFocusSessions is a small bounded history list, no pagination needed
// (same reasoning as the AI chat conversations list).
export const ACTIVE_FOCUS_SESSION_QUERY = gql`
  query ActiveFocusSession {
    activeFocusSession {
      id
      taskId
      taskTitle
      plannedDurationMinutes
      kind
      startedAt
      status
    }
  }
`;

export const RECENT_FOCUS_SESSIONS_QUERY = gql`
  query RecentFocusSessions($first: Int) {
    recentFocusSessions(first: $first) {
      id
      taskTitle
      plannedDurationMinutes
      kind
      startedAt
      endedAt
      status
    }
  }
`;

export const START_FOCUS_SESSION = gql`
  mutation StartFocusSession($input: StartFocusSessionInput!) {
    startFocusSession(input: $input) {
      session {
        id
        taskId
        taskTitle
        plannedDurationMinutes
        kind
        startedAt
        status
      }
      errors {
        code
        message
      }
    }
  }
`;

export const COMPLETE_FOCUS_SESSION = gql`
  mutation CompleteFocusSession($id: ID!) {
    completeFocusSession(id: $id) {
      session {
        id
        status
      }
      errors {
        code
        message
      }
    }
  }
`;

export const CANCEL_FOCUS_SESSION = gql`
  mutation CancelFocusSession($id: ID!) {
    cancelFocusSession(id: $id) {
      session {
        id
        status
      }
      errors {
        code
        message
      }
    }
  }
`;

// Journaling (PRD §7.3). Cursor-paginated, most-recent-first — same shape
// as COMPLETED_TASKS_QUERY, since a journal is naturally unbounded over
// time the same way completed tasks are.
export const JOURNAL_ENTRIES_QUERY = gql`
  query JournalEntries($after: String) {
    journalEntries(first: 20, after: $after) {
      edges {
        cursor
        node {
          id
          content
          sentimentScore
          createdAt
          updatedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const CREATE_JOURNAL_ENTRY = gql`
  mutation CreateJournalEntry($input: CreateJournalEntryInput!) {
    createJournalEntry(input: $input) {
      entry {
        id
        content
        sentimentScore
        createdAt
        updatedAt
      }
      errors {
        code
        message
      }
    }
  }
`;

export const UPDATE_JOURNAL_ENTRY = gql`
  mutation UpdateJournalEntry($id: ID!, $input: UpdateJournalEntryInput!) {
    updateJournalEntry(id: $id, input: $input) {
      entry {
        id
        content
        updatedAt
      }
      errors {
        code
        message
      }
    }
  }
`;

export const DELETE_JOURNAL_ENTRY = gql`
  mutation DeleteJournalEntry($id: ID!) {
    deleteJournalEntry(id: $id) {
      deletedEntryId
      errors {
        code
        message
      }
    }
  }
`;

// Daily reflection (PRD §7.3's 3-question end-of-day ritual).
export const TODAY_REFLECTION_QUERY = gql`
  query TodayReflection {
    todayReflection {
      id
      date
      answers {
        wentWell
        challenging
        carryForward
      }
      aiSummary
      updatedAt
    }
  }
`;

export const RECENT_REFLECTIONS_QUERY = gql`
  query RecentReflections($first: Int) {
    recentReflections(first: $first) {
      id
      date
      answers {
        wentWell
        challenging
        carryForward
      }
      aiSummary
    }
  }
`;

// Configurable daily reflection questions increment — a small, focused
// query (rather than reusing SETTINGS_QUERY wholesale), same reasoning
// POMODORO_SETTINGS_QUERY documents for its own equivalent: /reflection
// only ever needs these three fields, not the whole settings screen's
// worth of profile/subscription data.
export const REFLECTION_LABELS_QUERY = gql`
  query ReflectionLabels {
    me {
      id
      reflectionWentWellLabel
      reflectionChallengingLabel
      reflectionCarryForwardLabel
    }
  }
`;

export const SUBMIT_DAILY_REFLECTION = gql`
  mutation SubmitDailyReflection($input: SubmitDailyReflectionInput!) {
    submitDailyReflection(input: $input) {
      reflection {
        id
        aiSummary
      }
      errors {
        code
        message
      }
    }
  }
`;

// Morning/evening routines — a single query returns both, since the Today
// page renders both checklists side by side.
export const TODAY_ROUTINES_QUERY = gql`
  query TodayRoutines {
    todayRoutines {
      id
      type
      steps {
        id
        label
      }
      aiSequenced
      completedStepIds
      updatedAt
    }
  }
`;

export const SET_ROUTINE = gql`
  mutation SetRoutine($input: SetRoutineInput!) {
    setRoutine(input: $input) {
      routine {
        id
        type
        steps {
          id
          label
        }
        aiSequenced
        completedStepIds
      }
      errors {
        code
        message
      }
    }
  }
`;

export const SET_TODAY_ROUTINE_COMPLETION = gql`
  mutation SetTodayRoutineCompletion($input: SetTodayRoutineCompletionInput!) {
    setTodayRoutineCompletion(input: $input) {
      routine {
        id
        type
        completedStepIds
      }
      errors {
        code
        message
      }
    }
  }
`;

export const DELETE_ROUTINE = gql`
  mutation DeleteRoutine($type: RoutineType!) {
    deleteRoutine(type: $type) {
      deleted
      errors {
        code
        message
      }
    }
  }
`;

// AI recommendations (breaks, workouts, meals) — separate query/module from
// TodayPlan (RecommendationsModule, not TodayModule), same "an enhancement
// must never block the rest of the page" reasoning as routines and reflection.
export const TODAY_RECOMMENDATIONS_QUERY = gql`
  query TodayRecommendations {
    todayRecommendations {
      id
      recommendations {
        id
        category
        message
        dismissed
      }
      generatedAt
    }
  }
`;

export const GENERATE_RECOMMENDATIONS = gql`
  mutation GenerateRecommendations {
    generateRecommendations {
      recommendationRun {
        id
        recommendations {
          id
          category
          message
          dismissed
        }
      }
      errors {
        code
        message
      }
    }
  }
`;

export const DISMISS_RECOMMENDATION = gql`
  mutation DismissRecommendation($id: ID!) {
    dismissRecommendation(id: $id) {
      recommendationRun {
        id
        recommendations {
          id
          category
          message
          dismissed
        }
      }
      errors {
        code
        message
      }
    }
  }
`;

// AI recommendations acting on your behalf increment. $input (Customize
// act-on defaults at the point of acting increment) is optional — every
// existing caller that never passes it keeps getting the exact same fixed-
// default behavior.
export const ACT_ON_RECOMMENDATION = gql`
  mutation ActOnRecommendation($id: ID!, $input: ActOnRecommendationInput) {
    actOnRecommendation(id: $id, input: $input) {
      recommendationRun {
        id
        recommendations {
          id
          category
          message
          dismissed
        }
      }
      startedFocusSessionId
      bookedCalendarEventId
      createdTaskId
      errors {
        code
        message
      }
    }
  }
`;

// Smart notifications increment — notifications only ever shows already-due
// rows (see NotificationsService.listRecent), so there's no separate
// "unseen vs. seen" filter needed here, just read/unread.
export const NOTIFICATIONS_QUERY = gql`
  query Notifications($first: Int) {
    notifications(first: $first) {
      id
      type
      title
      body
      deeplink
      read
      createdAt
    }
  }
`;

export const UNREAD_NOTIFICATION_COUNT_QUERY = gql`
  query UnreadNotificationCount {
    unreadNotificationCount
  }
`;

export const MARK_NOTIFICATION_READ = gql`
  mutation MarkNotificationRead($id: ID!) {
    markNotificationRead(id: $id) {
      notification {
        id
        read
      }
      errors {
        code
        message
      }
    }
  }
`;

export const NOTIFICATION_PREFERENCES_QUERY = gql`
  query NotificationPreferences {
    me {
      id
      quietHoursStart
      quietHoursEnd
      wakeUpTime
      pushNotificationsEnabled
      emailNotificationsEnabled
      smsNotificationsEnabled
      phoneNumber
      voiceNotificationsEnabled
      autoApplyMorningPlanEnabled
    }
  }
`;

// Notification controls increment (2026-08-25). A small, standalone query
// (not reused from NOTIFICATION_PREFERENCES_QUERY above) specifically so
// VoiceNotifications.tsx can fetch just this one field imperatively via the
// plain apolloClient singleton — it's mounted in layout.tsx outside
// <Providers> (see that file's own comment on why: no auth/Apollo *context*
// dependency, active on every page including signed-out ones), so it has no
// React Apollo context to run a normal useQuery hook against. Same
// underlying client, just called directly rather than through a hook.
export const VOICE_NOTIFICATIONS_PREF_QUERY = gql`
  query VoiceNotificationsPref {
    me {
      id
      voiceNotificationsEnabled
    }
  }
`;

// Goals (Database Design Document §4.2, PRD §7.3 "long-horizon objectives
// that tasks and habits ladder up to"). The backend (GoalsService/Resolver,
// Task.goalId/goal field) has existed since the very first Tasks increment
// — this closes the one real MVP gap found in the post-launch audit: there
// was never a frontend screen for it, so a real, working API sat completely
// unreachable from the UI. No deleteGoal mutation exists (by design — see
// goals.service.ts): "done with this goal" is a status change to COMPLETED
// or ABANDONED, not a delete, so history isn't destroyed.
// Goal progress view increment: taskCount/completedTaskCount are computed
// fresh by GoalsService on every read (no new column) — adding them here
// once, in the shared fragment, covers the list query and both mutations'
// return payloads in one place, same "one fragment, three call sites"
// convention this file already uses.
const GOAL_FIELDS = `
  id
  title
  description
  targetDate
  status
  createdAt
  taskCount
  completedTaskCount
  linkedHabitCount
`;

export const GOALS_QUERY = gql`
  query Goals($status: GoalStatus) {
    goals(status: $status) {
      ${GOAL_FIELDS}
    }
  }
`;

export const CREATE_GOAL = gql`
  mutation CreateGoal($input: CreateGoalInput!) {
    createGoal(input: $input) {
      goal {
        ${GOAL_FIELDS}
      }
      errors {
        code
        message
      }
    }
  }
`;

export const UPDATE_GOAL = gql`
  mutation UpdateGoal($id: ID!, $input: UpdateGoalInput!) {
    updateGoal(id: $id, input: $input) {
      goal {
        ${GOAL_FIELDS}
      }
      errors {
        code
        message
      }
    }
  }
`;

export const UPDATE_NOTIFICATION_PREFERENCES = gql`
  mutation UpdateNotificationPreferences($input: UpdateNotificationPreferencesInput!) {
    updateNotificationPreferences(input: $input) {
      user {
        id
        quietHoursStart
        quietHoursEnd
        wakeUpTime
        pushNotificationsEnabled
        emailNotificationsEnabled
        smsNotificationsEnabled
        phoneNumber
        voiceNotificationsEnabled
        autoApplyMorningPlanEnabled
      }
      errors {
        code
        message
      }
    }
  }
`;

// Real notification delivery increment. `vapidPublicKey` is fetched live
// (not baked into a NEXT_PUBLIC_ env var) so it can never drift out of sync
// with whatever key the backend is actually configured with — see
// push.resolver.ts's own comment on the same choice. Returns null when the
// backend has no VAPID keys configured, which PushSubscribeButton treats as
// "browser notifications aren't available," not an error.
export const VAPID_PUBLIC_KEY_QUERY = gql`
  query VapidPublicKey {
    vapidPublicKey
  }
`;

export const REGISTER_PUSH_SUBSCRIPTION = gql`
  mutation RegisterPushSubscription($input: RegisterPushSubscriptionInput!) {
    registerPushSubscription(input: $input) {
      registered
      errors {
        code
        message
      }
    }
  }
`;

export const UNREGISTER_PUSH_SUBSCRIPTION = gql`
  mutation UnregisterPushSubscription($endpoint: String!) {
    unregisterPushSubscription(endpoint: $endpoint) {
      unregistered
      errors {
        code
        message
      }
    }
  }
`;

// Native app shell increment (2026-08-20) — see NativePushRegistration.tsx
// for why this is a separate pair of mutations from
// REGISTER_PUSH_SUBSCRIPTION/UNREGISTER_PUSH_SUBSCRIPTION above rather than
// reusing them: a native FCM token has no p256dh/auth keys and isn't
// identified by "endpoint."
export const REGISTER_NATIVE_PUSH_TOKEN = gql`
  mutation RegisterNativePushToken($input: RegisterNativePushTokenInput!) {
    registerNativePushToken(input: $input) {
      registered
      errors {
        code
        message
      }
    }
  }
`;

export const UNREGISTER_NATIVE_PUSH_TOKEN = gql`
  mutation UnregisterNativePushToken($token: String!) {
    unregisterNativePushToken(token: $token) {
      unregistered
      errors {
        code
        message
      }
    }
  }
`;

// On-demand diagnostic increment (2026-08-19) — see push.resolver.ts's own
// comment on sendTestNotification for why this bypasses the normal
// reminder pipeline entirely (quiet hours, preferences, batching) and never
// touches Notification history.
export const SEND_TEST_NOTIFICATION = gql`
  mutation SendTestNotification {
    sendTestNotification {
      sent
      subscriptionCount
      errors {
        code
        message
      }
    }
  }
`;

// Diagnostic onboarding increment (PRD §7.1 / UI/UX Design Document §5,
// §10). ME_ONBOARDING_QUERY powers OnboardingGate's global redirect check —
// deliberately its own small query (not folded into ME_TIMEZONE_QUERY)
// since it's read from a different component for a different reason, same
// "one query per concern" convention NOTIFICATION_PREFERENCES_QUERY already
// follows for its own `me` fields.
export const ME_ONBOARDING_QUERY = gql`
  query MeOnboarding {
    me {
      id
      onboardingCompletedAt
    }
  }
`;

// Re-enter onboarding increment — its own dedicated query (same "one query
// per concern" convention as ME_ONBOARDING_QUERY right above), read once by
// the onboarding page itself to pre-fill the quiz's four applicable
// questions and decide whether to skip straight past the Welcome step.
// Deliberately doesn't include the "biggest source of overload" answer —
// see onboarding/page.tsx's own note on why that one specifically isn't
// pre-filled.
export const ONBOARDING_PREFILL_QUERY = gql`
  query OnboardingPrefill {
    me {
      id
      onboardingCompletedAt
      onboardingWizardStep
      chronotype
      workHoursStart
      workHoursEnd
      quietHoursStart
      quietHoursEnd
    }
  }
`;

// Resumable onboarding wizard increment. Called once, best-effort, right
// after the calendar step's own Continue button is clicked — see
// onboarding/page.tsx's own comment on why a failure here never blocks
// moving to the next step. The CALENDAR transition itself needs no separate
// call — completeOnboarding above already records it server-side the
// moment the quiz submits, since that's always the very next step.
export const RECORD_ONBOARDING_WIZARD_STEP = gql`
  mutation RecordOnboardingWizardStep($step: OnboardingWizardStep!) {
    recordOnboardingWizardStep(step: $step) {
      user {
        id
        onboardingWizardStep
      }
      errors {
        code
        message
      }
    }
  }
`;

export const COMPLETE_ONBOARDING = gql`
  mutation CompleteOnboarding($input: CompleteOnboardingInput!) {
    completeOnboarding(input: $input) {
      user {
        id
        onboardingCompletedAt
      }
      errors {
        code
        message
      }
    }
  }
`;

// Life analytics / trend views increment (PRD §7.3). Everything here is
// computed fresh on read — no mutation, no new domain data, just
// aggregation over what other increments already log. $days is optional;
// the server clamps and defaults it (7-90, defaulting to 30 — see
// AnalyticsService), so omitting it entirely is the normal case.
export const ANALYTICS_SUMMARY_QUERY = gql`
  query AnalyticsSummary($days: Int) {
    analyticsSummary(days: $days) {
      windowDays
      dailyMoodEnergy {
        date
        averageMood
        averageEnergy
      }
      dailySleep {
        date
        durationMinutes
        qualityScore
      }
      habitStreaks {
        habitId
        title
        currentStreak
        dueDaysInWindow
        completedDaysInWindow
        completionRatePercent
      }
      routineConsistency {
        type
        currentStreak
        daysInWindow
        completedDaysInWindow
        completionRatePercent
      }
      correlations {
        metricALabel
        metricBLabel
        lagDays
        coefficient
        sampleSize
        description
      }
      dailyTaskCompletions {
        date
        completedCount
      }
      dailyFocusMinutes {
        date
        completedMinutes
        completedSessions
      }
      focusSessionConsistency {
        currentStreak
        daysInWindow
        completedDaysInWindow
        completionRatePercent
      }
      dailyJournalActivity {
        date
        entryCount
      }
    }
  }
`;

// Tasks list/edit screen increment: closes the longest-standing gap in the
// app — `updateTask`, `cancelTask`, and `createTag` have all been real,
// e2e-tested backend mutations since the very first Tasks increment, but
// until now nothing on the frontend called any of them except AiPlanCard/
// WeeklyPlanCard's narrow "Edit task" control (title/priority/duration
// only, from inside a plan review row). This is the first dedicated task
// list/edit surface.
//
// Tasks pagination increment: originally one plain, unfiltered connection
// query (`first: 100`, no status filter at all) that fetched every task
// regardless of status — including COMPLETED ones this screen never even
// displays — then filtered into the Open/Cancelled tabs entirely
// client-side, which is what forced a hard 100-task cap in the first
// place (see the README's own note on this). Replaced with two real,
// independently cursor-paginated queries, one per tab, each asking the
// server for only the statuses that tab actually shows — `statuses:
// [PENDING, IN_PROGRESS]` for Open (see tasks.resolver.ts's new `statuses`
// arg), `status: CANCELLED` for Cancelled (the older singular arg, same one
// COMPLETED_TASKS_QUERY below already uses) — so an account with any
// number of tasks can page through all of them via "Load more," the same
// pattern `/more`'s completed-tasks list already established.
export const OPEN_TASKS_QUERY = gql`
  query OpenTasks($after: String) {
    tasks(statuses: [PENDING, IN_PROGRESS], first: 20, after: $after) {
      edges {
        cursor
        node {
          id
          title
          description
          status
          priority
          dueDate
          estimatedDurationMinutes
          goal {
            id
            title
          }
          tags {
            id
            name
            color
          }
          subtasks {
            id
            title
            status
          }
          createdAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const CANCELLED_TASKS_QUERY = gql`
  query CancelledTasks($after: String) {
    tasks(status: CANCELLED, first: 20, after: $after) {
      edges {
        cursor
        node {
          id
          title
          description
          status
          priority
          dueDate
          estimatedDurationMinutes
          goal {
            id
            title
          }
          tags {
            id
            name
            color
          }
          subtasks {
            id
            title
            status
          }
          createdAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// All goal statuses, not just ACTIVE (unlike QuickAddTask's picker) — a
// full task-editing screen reasonably wants to see and clear a link to a
// goal that's since been completed or abandoned, not just silently drop it
// from the picker's option list.
export const ALL_GOALS_QUERY = gql`
  query AllGoals {
    goals {
      id
      title
      status
    }
  }
`;

export const CANCEL_TASK = gql`
  mutation CancelTask($id: ID!) {
    cancelTask(id: $id) {
      task {
        id
        status
      }
      errors {
        code
        message
      }
    }
  }
`;

// Frontend wrapper for the same createTag mutation the original Tasks
// increment already built and e2e-tested — this page is the first UI
// caller. `createTag` upserts by (userId, name) (see tasks.service.ts), so
// calling it again with a name that already exists just returns that same
// tag rather than duplicating it — exactly what lets this page's plain
// comma-separated tag text field resolve names to ids without needing a
// separate "list my tags" query to check against first.
export const CREATE_TAG = gql`
  mutation CreateTag($input: CreateTagInput!) {
    createTag(input: $input) {
      tag {
        id
        name
      }
      errors {
        code
        message
      }
    }
  }
`;
