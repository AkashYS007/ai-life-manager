# AI Life Manager — Demo Walkthrough

A script for showing this app to someone else end-to-end. Follow it top to bottom in one sitting — each section builds on data created in the one before it (the tasks you add early on are what the AI plans around later, etc.).

**Before you start:** run the backend (`cd apps/backend && npm run dev`) and the frontend (`cd apps/web && npm run dev`), then open `http://localhost:3000`. In dev-auth mode there's no real login screen — the app auto-creates an account for you on first request, so you'll land straight in the flow below.

---

## 1. Onboarding — first impression

**What it shows:** the app doesn't dump you on a blank dashboard; it establishes a baseline first.

- Open the app fresh (a brand-new account). You're redirected straight to `/onboarding` — you never see Today until this is done.
- **Welcome screen:** one line of vision copy, one button: **Get started**.
- **Diagnostic quiz** (5 questions, all skippable, single-choice cards):
  - *When do you naturally have the most energy?* → pick **Morning person**
  - *What time do you usually start work?* → pick **8:00 AM**
  - *What time do you usually stop work?* → pick **6:00 PM**
  - *When should we stay quiet — no notifications?* → pick **11 PM – 8 AM**
  - *What's your biggest source of overload right now?* → pick **Work & career**
  - Click **Continue**.
- **Connect calendar:** show the Google/Microsoft/Apple connect cards (real OAuth buttons — you can skip this live if you don't want to actually connect an account on stage). Click **Continue**.
- **First plan:** the app calls the AI immediately. On a brand-new account with no tasks yet, you'll see an honest message — *"You don't have any open tasks yet..."* — instead of an error. Click **Go to Today →**.

**Talking point:** everything you just answered (morning person, 8–6 work hours, quiet hours, "overloaded by work") is now live data the AI will actually use for the rest of the demo — not just stored and forgotten.

---

## 2. Today — the home screen

**What it shows:** the single dashboard the PRD calls for — plan, state, next action, all in one view.

Point out the layout top to bottom: greeting header → quick links (Focus, Reflect, Routines, Notifications, Goals) → routine checklists (empty for now) → mood/energy/sleep check-in → AI daily plan card → AI weekly/monthly plan card → AI recommendations card → habits → calendar events → task list → quick-add box.

---

## 3. Goals — long-horizon objectives

**What it shows:** tasks aren't just a flat list — they can ladder up to something bigger.

- Click **Goals →** from Today.
- Create one: title `Ship the Q3 launch`, description `Get the new pricing page live`, target date a few weeks out. Click **Create goal**.
- Point out the Active / Completed / Abandoned tabs.

**Talking point:** worth being upfront about — this is the one feature built after the main list, closing a gap where a fully-working backend existed from day one but nothing on the frontend ever reached it.

---

## 4. Tasks — with AI duration estimation and goal linkage

**What it shows:** task creation, the AI estimating how long something will take, and linking a task to the goal you just created.

- In the quick-add box at the bottom of Today, type: `Write Q3 planning doc`
- Click the small **AI** button next to the duration field. Watch it fill in a suggested number of minutes (e.g. `45`) — call out that this is a real Claude call, not a hardcoded guess.
- A small dropdown now also appears below the input (since you have an active goal) — select **Ship the Q3 launch** to link this task to it.
- Hit Enter to create the task — point out the goal's name now shows right under the task title on Today.
- Add two or three more quick ones, no goal needed: `Reply to client emails`, `Prep for 1:1`, `Gym`.
- Check one off. A prompt appears: *"How long did this actually take?"* — enter a number (e.g. `60`, deliberately higher than the estimate) and confirm.
- Click **Tasks →** on Today — this is the new full task list/edit screen. Click **Edit** on one of the tasks you just created, change its priority or add a due date, click **Save**. Try clearing the goal dropdown back to "No goal" and clearing the tags field, too.
- Right below that same task, type into **"Add a subtask…"** (e.g. `Outline the doc`) and click **Add** — it shows up with a `0/1` count next to it. Check it off, point out the count updates to `1/1` and the text gets a strikethrough. Add a second subtask, then hit **Remove** on the first one — it disappears for good, same as cancelling a regular task.
- Go back to Today — the task itself now shows a small `1/1 subtasks` (or whatever the count is) badge, read-only, next to its duration estimate.

**Talking point:** that actual-vs-estimated gap is quietly training the AI — after a few of these, it starts padding future estimates for this person automatically (you'll see this again in the Memory section). On the Tasks screen: this closes the single longest-standing gap in this project — `updateTask`/`cancelTask`/`createTag` have been real, working mutations since the very first Tasks increment, but there was never a screen that actually called them until now. Subtasks are the same story in miniature — `Task.subtasks`/`parentTaskId` have been real, working database columns since that same original increment, quietly unused by any screen until just now. One more thing worth mentioning even though it's not practical to demo live (it'd mean creating 21 tasks on camera): each tab on this screen now pages 20 at a time with a real "Load more" button instead of silently capping at 100 tasks total across every status — closes what used to be this screen's own hardest limit.

---

## 5. Calendar

**What it shows:** native events plus real two-way sync with Google/Microsoft/Apple.

- Go to **Calendar** in the bottom nav.
- Add a native event: `Team standup`, today, 30 minutes.
- Tap **Edit** on that same event, change its title to `Team standup (moved)` and push its time 30 minutes later, tap **Save** — point out this editor is new; there was no way to change an event's own title/time from this app at all before this increment.
- Point out the day-view paging (← →) and the three connect cards (Google/Microsoft/Apple) — if one's already connected from onboarding, show the "last synced" timestamp and hit **Sync now**.
- If a Google or Microsoft event is actually connected: edit one of its rows the same way, save, and — this is the one worth actually proving live if you have the time — flip over to the real Google Calendar or Outlook and show the change landed there too, not just in this app.
- Mention the one real limitation still worth being upfront about: Apple sync is pull-only, so an Apple-sourced event's edit here stays local-only and never reaches Apple Calendar.

---

## 6. AI daily plan — the core differentiator

**What it shows:** the actual scheduling engine, not just a suggestion box — and that a proposal isn't take-it-or-leave-it.

- Back on **Today**, click **Generate my plan** on the AI plan card.
- It proposes specific times for your open tasks, working around the calendar event you just added, and shows *why* for each (the reason text).
- On one of the suggested changes, click **Edit time**, pick a different time, click **Done** — the row now shows "(edited)" and the card's buttons switch to **Save & apply changes** / **Discard edits**.
- Click **Save & apply changes** — the time you picked gets written onto the real task, not the AI's original suggestion. Reload the page to prove it stuck, and note the plan's status is now **EDITED**, not **ACCEPTED** — a real, distinct audit trail of "this was applied with a tweak," not just accepted as-is.
- If you have another open task the AI didn't propose a time for, click **+ Add a task**, pick it from the dropdown, pick a time, click **Add to plan** — it shows up labeled "(added)," and **Save & apply changes** applies it for real too, right alongside any edits.
- On any suggested change, click **Edit task** (next to Edit time/Remove), change the title or duration, click **Save task** — it writes the task itself immediately, and the footer switches to Save & apply changes even without a time edit, since duration changes what actually gets applied.

**Talking point:** nothing gets scheduled without you explicitly accepting — and now that includes editing first. Worth mentioning if asked: you can also click **Remove** on a suggestion instead of editing it, to drop it from the plan entirely without touching the rest; you can add a task the AI never suggested at all, not just adjust what it did; you can edit a task's own title/priority/duration right from the review card, not just its time; and if you try to edit a time (or a duration, or add a task) into a conflict, the save still succeeds but that one change gets declined and explained in the summary, with time edits kept at their original AI-proposed time and skipped adds or duration conflicts simply left off the plan — the same "explain, don't silently discard" principle the original conflict-dropping behavior already used at generation time.

---

## 7. Weekly / monthly plan

**What it shows:** the same engine, widened to a longer horizon.

- Scroll to the **Longer-range plan** card below the daily one.
- Toggle to **Week**, click **Generate**. Point out the proposed times now span multiple days with real dates, not just times.
- Toggle to **Month** and generate again — same idea, 30 days out.
- If you have a habit due later in the window (not today), point out the plan still leaves its protected time alone — see the Weekly/monthly plans protecting habits across the window section below for the live walkthrough.

---

## 8. Habits

**What it shows:** recurring commitments the AI protects time for.

- Go to **Habits** in the bottom nav.
- Create one: `Morning workout`, daily, preferred time `7:00 AM`, protected duration `30` minutes.
- Back on Today, re-generate the daily plan — show that it now works *around* the 7am habit block rather than scheduling over it.
- For editing that habit afterward — recurrence, time, protected duration, goal link, and reactivating a deactivated one — see the Habit-edit UI section below.

---

## 9. Focus sessions (Pomodoro)

**What it shows:** the deep-work timer, tied to a real task.

- From Today, click **Start a focus session →**.
- Pick one of your open tasks, choose a duration (e.g. 25 minutes), start it.
- Show the countdown, then either let it run down or click complete early to demo the flow without waiting.
- Point out **Recent sessions** below the timer once it's done.
- For the full automatic work/break chaining, see the Automatic Pomodoro work/break cycling section below.

---

## 10. Daily check-ins — mood, energy, sleep

**What it shows:** the lightweight signal collection the AI reasons over.

- On Today, use the mood/energy quick-tap widgets (1–5 scale) and log a sleep entry (hours + quality).
- Talking point: these numbers directly change what the AI proposes — low energy or short sleep makes it schedule lighter, more conservative days.

---

## 11. Journal

**What it shows:** free-write journaling that feeds AI context.

- Go to **Journal**, write a couple of sentences (e.g. *"Felt overwhelmed by the client emails today, but the workout helped."*).
- Save it. Show it appears in the history list, most recent first.

---

## 12. Daily reflection

**What it shows:** the 3-question end-of-day ritual, AI-summarized.

- From Today, click **Reflect on today →**.
- Answer the three prompts (what went well / what was challenging / what to carry forward) with a sentence each.
- Submit — the AI generates a short summary of your day from the answers. Show it, and the **Past reflections** list below.

---

## 13. Morning / evening routines

**What it shows:** configurable checklists, AI-sequenced.

- Go to **Routines** (link from Today).
- Add 3–4 morning steps (e.g. `Drink water`, `Stretch`, `Check calendar`, `Eat breakfast`) out of order on purpose.
- Save, then show the AI-sequenced ordering kick in — it reorders them into a sensible sequence.
- Back on Today, check a couple of steps off the checklist that now appears there.

---

## 14. AI recommendations

**What it shows:** proactive, contextual suggestions — not just answers to questions.

- On Today, click **Get recommendations** on the AI recommendations card.
- You'll get 1–3 short suggestions (a break, a workout nudge, a meal reminder) grounded in everything logged so far today.
- Dismiss one with the **×** to show that interaction.
- For the real one-tap follow-through action next to each suggestion, see the AI recommendations acting on your behalf section below.

---

## 15. AI chat

**What it shows:** the natural-language interface to the whole system.

- Go to **Chat**, ask something like: *"What should I focus on for the rest of today?"*
- Show the response references your actual tasks/calendar/state — not a generic productivity tip.
- Start a second question in the same thread to show conversation history.

---

## 16. AI Memory — manual and automatic

**What it shows:** the "moat" feature — a persistent model of the person, not a stateless chatbot.

- Go to **Memory**. Add a manual fact: `Prefers no meetings before 10am`.
- Talking point: this fact is now injected into *every* AI prompt in the app — plan generation, chat, recommendations, duration estimates all see it.
- Mention (you don't need to demo this live, it takes real usage history to trigger): the app also *automatically* learns four things without being told — whether you tend to accept or reject AI plans, whether your task estimates run long or short, your empirical chronotype (from when your energy peaks and when you actually complete focus sessions, not just what you said in onboarding), and now your recent journal sentiment trend (see Journal sentiment analysis below).

---

## 17. Notifications — and the new scheduler behind some of them

**What it shows:** context-aware, quiet-hours-respecting alerts, some now genuinely time-based.

- Go to **Notifications** (link from Today, shows an unread count badge).
- Show the notification that was created earlier when you generated a plan or recommendations.
- Open **Preferences** on that page — show quiet hours and the channel toggles. Push and email now genuinely deliver (see section 21 below); SMS still only saves the preference and doesn't send yet — worth being upfront about that if asked.

**Talking point (hard to demo live, worth explaining instead):** as of the Scheduler increment, a background job now runs every 15 minutes checking every account for four things — an unchecked morning or evening routine near 8am/8pm, an unsubmitted daily reflection near 9pm, and any habit that's 15–120 minutes overdue — and fires a real notification through this exact same page if so. It's not visible in a live demo unless you happen to be running it at exactly the right hour, but it's real, tested code, not a mock — mention it and, if someone wants proof, you can show the "Scheduler / reminder sweep" tests in the e2e suite passing.

---

## 18. Automatic AI re-planning — the plan that updates itself

**What it shows:** the AI plan isn't just something you ask for once — it reacts to what you actually do.

- On Today, generate a plan manually first (so there's a baseline plan run to compare against).
- Complete one of your open tasks (checkbox, skip the actual-duration prompt or fill it in — either way).
- Wait a beat, then refresh Today — a new plan run appears on its own, with a summary and proposed times that account for the task you just finished, without tapping **Generate my plan** again.
- Same thing happens if you add a new calendar event instead of completing a task.
- Also generate a Week (or Month) plan once via the Week/Month toggle on the plan card, then complete another task or add another event — reopen Today afterward and the weekly/monthly plan has refreshed too, not just today's. Worth calling out that this refresh only shows up once that card's own query re-runs (reopening the page works; it doesn't live-update the moment the background auto-replan finishes).
- Three more triggers do the same thing: complete a habit on Today, log a mood or energy check-in, or check off every step of a routine (a *partial* routine — checking off some but not all steps — deliberately does nothing).
- Three more beyond that: write a journal entry, complete a focus session (cancelling one deliberately does nothing), or submit a daily reflection. Any of these eight, with at least one open task to plan around, produces the same kind of fresh plan run as completing a task does.

**Talking point:** this closes the other half of "nothing runs on its own" — the Scheduler increment (above) made reminders time-based; this makes re-planning event-based. Under the hood, each of these eight real actions fires a lightweight event that a listener on the planner picks up and turns into a real plan run — DAY, WEEK, *and* MONTH now, each tagged with its own `triggerEvent` (`auto_task_completed`, `auto_calendar_changed`, `auto_habit_completed`, `auto_checkin_logged`, `auto_routine_completed`, `auto_journal_entry`, `auto_focus_session_completed`, `auto_reflection_submitted` — versus `manual_request` for the button) so it's always possible to tell which kind produced a given plan. Guardrails keep it from being noisy, one per scope: DAY still gets a 10-minute cooldown (completing five tasks in a row produces one fresh plan, not five AI calls), but WEEK gets 3 hours and MONTH gets 12 — a much longer wait, since one signal is a weaker hint that a whole week or month needs rethinking, and regenerating either is a heavier AI call to be firing constantly. It's a silent no-op either way — not an error, not an extra notification — if you have no open tasks left or haven't configured an Anthropic API key. If asked why sleep logging isn't one of the eight triggers: it's usually logged about *last* night, not something changing right now, a deliberately weaker signal than a fresh mood/energy check-in. If asked why this doesn't show up as its own notification: a re-plan you didn't ask for shouldn't also interrupt you to announce itself — the plan card on Today just reflects the latest state, same as it always has.

---

## 19. Life analytics — Insights

**What it shows:** all the data you've been logging turned into something you can actually look back at.

- Click **Insights →** on Today.
- Point out the 2 weeks / 30 days / 90 days toggle at the top — switch it and watch everything below recompute.
- Show the mood & energy trend chart (two lines, one color each) and the sleep duration chart underneath it.
- Scroll to the habit streak cards and routine consistency cards — each shows a current streak and a completion percentage with the real "X of Y" count underneath.
- Scroll to the bottom: the new **"Patterns worth noting"** card. On a fresh or lightly-used account it'll show "not enough data yet" — that's the honest empty state, not a bug. Point out that, unlike the cards above it, this one always renders even with nothing to show.
- To show a real one appearing: log mood and sleep duration on Today for at least 5 different days with an actual relationship between them (or ask me to seed a demo relationship the same way the backend e2e test does — real mutations plus one direct database backdate for `loggedAt`, the same trick used for multi-day habit streaks). A sentence like "Higher sleep duration tends to come with higher mood in this window (strong correlation, r = 0.94, 6 days with both logged)" appears once it clears the bar.
- Point out any entry with a small lag badge in front of it — **"Next-day"** for a one-day lag, or **"2 days later"**/**"3 days later"** for a longer one — each checked completely independently of the same-day version of that same pair, and independently of each other. Worth showing side by side if more than one happens to appear for the same demo dataset: one might read "Higher sleep duration tends to come with higher mood in this window..." and another "Higher sleep duration one day tends to come with higher mood the next day..." — genuinely different questions, genuinely different (if similar-looking) answers.
- Point out a pair that appears **twice with labels swapped** — e.g. "Higher sleep duration tends to come with lower mood the next day..." alongside "Higher mood tends to come with lower sleep duration the next day..." — that's the reverse-direction check: does A predict B, *and* does B predict A, checked and reported completely separately. Worth being clear that this is genuinely two different questions with two different real answers, not the same finding shown twice.
- Scroll past Sleep duration to **Tasks completed**, and past Routine consistency to **Focus sessions** (with its own streak card) and **Journal activity**. Unlike the mood/sleep charts, a day with zero of any of these shows as a real, visible zero on the chart — point this out if asked why the line doesn't just disappear on a slow day.
- These three now feed "Patterns worth noting" too — a pattern like "Higher tasks completed tends to come with higher mood in this window" can show up there alongside the sleep/habit ones, using the exact same real Pearson math and the same minimum-sample-size/minimum-strength bar.
- Point out a pattern where **neither side is Mood or Energy** — e.g. "Higher focused minutes tends to come with higher journal entries in this window" — that's the newest kind of pattern this card can surface: any two of sleep duration/quality, habit completion, tasks completed, focused minutes, or journal entries checked directly against each other, not routed through mood or energy at all.

**Talking point:** nothing on this page is new data — it's all real aggregation, computed fresh on every load, over check-ins/habit logs/routine logs other increments have been writing to the database the whole time. Worth calling out if someone asks "is that a real chart library" — it's a small hand-rolled inline SVG component, not a new dependency, the same judgment call the Apple calendar sync increment made hand-rolling its own small ICS parser instead of pulling in a library for a narrow need. If someone wants to see a real, non-flat streak: complete a habit a couple days in a row (or ask me to backdate one via the database for a demo, same trick the e2e tests use to test a multi-day streak deterministically). On the correlations card specifically: it's a real Pearson correlation coefficient (independently checked against `numpy` before being trusted in the code — not eyeballed), computed only over days where both metrics were actually logged, and it only surfaces a pair once there's a real sample size (5+ paired days) and a real relationship (|r| ≥ 0.3) — worth being direct if asked "does this prove anything": no, it's phrased as a tendency, not a causal claim, and it can't tell "bad sleep causes low mood" apart from "low mood causes bad sleep" apart from "something else is behind both." If asked "why show both a same-day and a next-day version of the same thing" — because they can genuinely disagree; the demo dataset behind the second new backend e2e test was specifically built so the same-day correlation is essentially zero (≈0.02) while the next-day one is nearly perfect (≈0.98), on purpose, to make that point concretely rather than asserting it. The lag check now goes out to three days and checks both directions (up to 182 candidate checks per load now, up from 24 originally) — worth naming both new lag datasets if asked "did you actually check the two-day one works": one where same-day and one-day-lag sleep-vs-mood are both essentially zero but a two-day lag is real (r ≈ 0.92), and one where sleep predicting next-day mood is exactly zero but mood predicting next-day sleep is real (r ≈ -0.87) — both independently verified twice (`numpy` and a direct replica of the app's own shift-and-correlate code) before being hardcoded into tests, the same discipline every correlation number in this project has gotten. Worth mentioning if someone notices the list never seems to run long: there's now a silent cap on the 15 strongest patterns shown, since with 26 base pairs instead of 12, real correlated activity (a busy day naturally moving tasks/focus/journal together, say) could otherwise produce a genuinely overwhelming list.

---

## 20. PWA + offline support

**What it shows:** this is no longer just a web app — it's installable, and it keeps working (for the core things you'd actually need mid-flight) with no connection at all.

- In Chrome/Edge, point out the install icon in the address bar — click it, and the app opens in its own standalone window, not a browser tab.
- Open DevTools → Network tab, check **Offline**.
- Reload the page — it still loads (the app shell was cached the moment you first visited it).
- With Offline still checked: add a task from Today, complete one, and write a journal entry. Each shows up immediately, and a small "changes waiting to sync" strip appears.
- Uncheck Offline — within a few seconds the strip clears on its own, no refresh needed. Reload to prove the changes really made it to the server, not just the local cache.

**Talking point:** this closes a real MVP requirement the PRD calls out explicitly (§10/§14) — not a nice-to-have added late, a gap that existed since day one of the frontend. Worth being direct if asked "so is there an iPhone app" — no, and there structurally can't be one built this way (native iOS/Android need Xcode and mobile toolchains, outside what this kind of build process can do); the installed PWA is the realistic mobile answer for now, and it's genuinely close to a native feel once installed. Also worth naming the scope honestly: offline support covers exactly the three actions the PRD names — adding a task, completing a task, journaling — not the whole app; anything else (editing a task's full details, generating an AI plan, chat) still needs a live connection and will show its normal error state offline.

---

## 21. Real notification delivery — web push + email + SMS

**What it shows:** notifications now genuinely reach you, not just the in-app list — even with the tab closed.

- On **Notifications**, click **"Turn on browser notifications"** and accept the permission prompt.
- Trigger a notification (generate a plan, or generate recommendations) — a real OS-level notification pops up, not just the in-app badge updating.
- Click the notification itself — it focuses (or opens) the tab and lands on the right page.
- If you've set a `RESEND_API_KEY`, turn on the **Email** checkbox in Preferences, trigger another notification, and show the email actually arriving.
- If you've set the three `TWILIO_*` env vars, enter your own phone number (E.164 format, e.g. `+15551234567`) in the new **Phone number for SMS** field, turn on the **SMS** checkbox, save, trigger another notification, and show the text actually arriving on your phone.

**Talking point:** before the original version of this increment, "delivery" meant nothing more than the notification sitting there waiting for someone to open the app — now it's real Web Push (the standard, VAPID-based mechanism a browser-based PWA can use — no native FCM/APNs SDK or app-store account needed, matching what this app actually is), real email through Resend's API, and now real SMS through Twilio's API too — all three channels the PRD names actually send something now. Worth naming the honest scope: delivery overall is still best-effort, not a durable dispatcher — a failed delivery attempt is logged and the notification is still marked as attempted, not retried with backoff. The in-app Notifications page remains the fallback of last resort no matter what happens with any of the three channels — nothing here can make a notification vanish without a trace.

---

## 22. Settings — timezone, chronotype, and work hours

**What it shows:** the onboarding quiz's answers, finally editable somewhere other than that one-time quiz.

- Click **Settings →** on Today.
- Change **Chronotype** to a different option and **Work hours**, then **Save settings**. Reload the page — both stuck.
- Type a new value into the **Timezone** field — notice the helper text switches from "Syncing automatically from your browser" to "Set manually," and a **Use browser-detected automatically** button appears. Save, reload — it's still set manually. Click that button, save again, reload — it's back to syncing automatically.

**Talking point:** every one of these fields already had a real column and, for timezone and chronotype, a real mutation before this increment — the gap was purely that nothing in the UI ever reached them after the onboarding quiz's one-shot save. Work hours needed a small real backend extension (the mutation never accepted them before now — only the onboarding quiz's own one-shot mutation ever wrote them). Timezone needed one genuinely new piece of state: worth explaining if asked "why does typing in the box say 'manual' " — there's a silent background component (`TimezoneSync`) that's been auto-detecting your browser's timezone and saving it since the timezone auto-sync fix, and without a way to tell it "hands off," it would just overwrite whatever you typed here the next time any page loaded. The new manual flag is exactly that "hands off" signal, and the automatic button is the only way to hand control back. Worth being upfront if asked "where's the overload/priorities answer from onboarding" — it was never its own field; it's a plain fact on `/memory`, already editable there before this increment.

---

## 23. Broader account settings — name, plan, and deleting your account

**What it shows:** the rest of what "account settings" usually means, closing the gap the Settings screen's own README entry named right after it shipped.

- On `/settings`, edit **Display name** at the top and Save — reload, it's stuck. Point out where it shows up: Today's greeting.
- Scroll to the **Account** card — your email and status. The plan itself is a real, clickable picker now (Free/Plus/Pro) — see the Real billing/subscription management section later in this walkthrough for that part specifically.
- Scroll to the **Danger zone** — try clicking **Delete my account** with the confirmation field empty (disabled), type something other than `DELETE` (still disabled), then type `DELETE` exactly (enables). Don't actually click it live unless you're using a throwaway dev account — it's real and immediate.

**Talking point:** displayName editing was almost a non-event — `updateProfile` already accepted it, the gap was purely a missing input on the page. The Account card is the same story for `Subscription`: every account has had a real Free-tier row since the very first profile increment, it was just never shown anywhere. Account deletion is the one genuinely new piece of work, and worth explaining if asked "does this really delete everything" — while building it, it turned up that most of this app's tables (tasks, goals, habits, calendar events, journal entries, focus sessions, and more) were only ever plain `userId` columns with no real foreign key to `User` at all; only three tables (Subscription, Notification, PushSubscription) ever had a declared relation. So `deleteAccount` explicitly deletes across all 17 of the un-declared tables in one transaction before deleting the `users` row itself — a real fix for a real gap, not something that would have "just worked" from a plain `prisma.user.delete()`. After deleting, the same identity gets a completely fresh account next time — worth mentioning if asked "can I get my data back": no, there's no grace period or recovery window, this is immediate and final.

---

## 24. Editable email + re-enter onboarding

**What it shows:** two more real gaps closed on `/settings`, plus two real bugs found and fixed along the way.

- On `/settings`, in the **Account** card, look at the email row — under real Clerk auth there's now a **Change email →** button that opens Clerk's own hosted account-management modal; under dev auth (this build), it's explanatory text instead, since there's no real identity provider here to change anything through.
- Scroll down to **Redo the onboarding quiz →**, click it — the quiz jumps straight to the questions (no Welcome screen), and chronotype/work hours/quiet hours are already pre-filled with whatever you set before. Change one, submit, go back to Settings — it stuck.

**Talking point:** the email piece is a case for "don't rebuild what already works correctly" — Clerk's own hosted modal handles real verification (a confirmation code, re-auth) that this app has no way to replicate on its own, so the button just opens that instead of a fake local text field. Worth mentioning if asked "does this app ever get confused about what your email is" — it used to: `getOrCreateFromAuth` only ever wrote your email once, at signup, so changing it through Clerk later would silently go stale in this app forever. That's fixed now — it resyncs on every request if the two disagree. Re-entering onboarding surfaced its own real bug: redoing the quiz used to create a *second* "biggest source of overload" memory fact instead of updating the one already there, since the write used a generic create-a-new-fact call instead of an update-by-key one. Fixed with a real upsert on a stable key — the fact you already had gets replaced, not duplicated, no matter how many times you redo the quiz. The one deliberate non-pre-fill: the overload/priorities answer itself doesn't come back pre-selected, since what's stored is a full sentence, not the raw option — reverse-parsing that back into one of five fixed cards wasn't judged worth the fragility.

---

## 25. No visible auto-plan indicator

**What it shows:** the last piece of "what's not done yet" this section itself used to name for automatic re-planning — the plan card can now tell you when *it*, not you, generated the plan you're looking at.

- Complete a task, log a mood/energy check-in, or finish a habit on `/today` — anything that fires a real auto-replan trigger — then look at the plan card that appears (may need a moment, and only fires within that trigger's own cooldown window). Next to "Proposed plan," there's now a small **Auto-generated** pill.
- For contrast, tap **Generate my plan** yourself — no pill. Same card, same layout, the only difference is the trigger.

**Talking point:** the data this relies on (`triggerEvent`) has existed since the very first automatic re-planning increment — every real trigger already wrote the correct `auto_*` string, already proven correct by eight backend e2e tests. The entire gap here was purely three frontend query fields and a couple of small conditionally-rendered badges — the kind of "real backend work already done, just never surfaced" gap this project has closed a few times now (broader account settings' Subscription card was the same story). Worth being upfront if asked "have you actually seen this render" — no, not against a real database in this build environment; it's been checked by hand against the exact conditions each trigger sets, not confirmed with a real browser load.

---

## 26. Goal progress view

**What it shows:** a goal finally tells you how you're actually doing on it, not just its title and target date.

- On `/goals`, any goal with real tasks linked to it now shows "N of M tasks done" and a small progress bar underneath its card.
- Create a brand-new goal — it shows "No tasks linked yet" instead of a confusing "0 of 0."
- Go to `/today`, quick-add a task, pick that goal from the "Link to goal" dropdown, add it, then complete it. Back on `/goals`, the count moves to "1 of 1 task done" and the bar fills.
- Abandon or cancel a task linked to a goal — point out its own total drops, since a cancelled task never counts against a goal's progress.

**Talking point:** `Task.goalId` and the real relation to `Goal` have existed since the very first Tasks increment — this was never a data gap, purely a missing rollup. The two new fields (`taskCount`, `completedTaskCount`) are computed fresh on every read, not stored counters that could drift out of sync with reality, and a cancelled task is deliberately excluded from the total — the same "cancelled is set apart, not held against you" rule the Tasks screen's own Open/Cancelled tabs already follow. Worth mentioning if asked "did you check the math" — yes, with a real backend test that completes one task, cancels another, and leaves a third open under the same goal, then asserts the exact resulting counts, not just a code read-through.

---

## 27. Real billing/subscription management

**What it shows:** the Plan card stops being a dead end — you can actually switch plans now, with one important, honest caveat.

- On `/settings`, scroll to the Account card's "Plan" section — three buttons: Free, Plus, Pro, each with a plain price. The current one is highlighted.
- Click a different one. It switches immediately — no confirmation, no card form. Once on a paid tier, a "Renews" date appears.
- Point at the note underneath: "Switching plans here is simulated — no real payment is processed." Reload the page — the change stuck.
- Switch back to Free — the renewal date disappears again.

**Talking point:** be upfront immediately, before anyone asks — this does not process a real payment. There's no Stripe integration anywhere in this project *at the point this section was written*. What it *does* do for real: it changes the actual database row every other part of this app already reads for your plan — the same `Subscription.tier`/`status` fields the old read-only Plan card showed. The deliberate choice not to build a fake credit-card form is worth explaining if asked "why didn't you just fake a checkout screen" — collecting fake card details would look like a real charge is happening when nothing is, the same reasoning this project already applied to not rebuilding email verification locally. One more thing worth mentioning if the conversation turns to "how do you know this is accessible" — the first version of this picker's "current plan" pill used a translucent tinted background that measured a real 4.13:1 contrast ratio in dark mode, under the 4.5:1 AA minimum; caught by actually computing it, not by eye, and fixed before this ever shipped.

*(This simulated flow is now the graceful fallback, not the whole story — see section 45, Real Stripe billing integration, further below.)*

---

## 28. Linking habits to goals

**What it shows:** goals finally ladder up from Habits too, not just Tasks, closing the one gap the PRD's own wording named but this app never built.

- On `/habits`, create a new habit — a "Link to goal" dropdown appears once at least one active goal exists (same rule as Today's task quick-add picker). Pick one, save the habit, and its title appears right on the habit's own row.
- On `/goals`, that same goal's card now shows a new "1 habit linked" line, separate from the existing task progress line.
- Link a second habit to the same goal — the count moves to "2 habits linked."

**Talking point:** this needs a real migration on your machine before it'll work — `Habit.goalId` is a brand-new column, run `npx prisma migrate dev --name add_habit_goal_link` in `apps/backend` first (see the Picking up section in the README for the exact steps). Worth explaining if asked "why is a habit's link only set at creation, not editable later" — there's no habit-edit UI in this app at all yet, only create/deactivate/complete, so there was never a surface to add a "change the goal" control to. Also worth naming if asked "why isn't the habit count folded into the task count" — a habit never reaches a terminal "done" state the way a task does, so "N of M done" framing genuinely doesn't fit it; it's its own real, separately-computed number instead.

---

## 29. Full custom habit recurrence

**What it shows:** habits stop being limited to "every day" or "these specific weekdays" — a habit can now recur every N days, every N weeks, monthly on a specific date, or monthly on something like "the third Tuesday" or "the last Friday."

- On `/habits`, the create form now has a third button next to "Every day"/"Specific days": "Monthly." Pick it, and choose either "a day of the month" (with a real day number, or a "last day of the month" checkbox) or "a specific weekday" (a "third Tuesday"-style pair of dropdowns).
- Notice the small "Every [N] day(s)/week(s)" field that now appears next to the original two options too — create a habit set to "every 3 days," and its row on `/habits` reads exactly that: "Every 3 days."
- Create one of each shape and watch the recurrence text on its row change to match: "Every 3 days," "Every 2 weeks: Mon, Wed," "Monthly on the 15th," "Monthly on the last day," "Monthly, third Tuesday."

**Talking point:** no migration needed this time — every new field is parsed out of the same `rrule` column that's been there since the very first Habits increment; nothing new was added to the schema. Worth explaining if asked "how do you know the math is actually right" — this is the one increment in the whole project where the underlying logic (not just the code around it) was verified by actually running tests: 35 real Jest unit tests, each one checked against a date that was independently computed ahead of time, not assumed (e.g. "the 3rd Tuesday of August 2026 is the 18th" was worked out with a throwaway script first, then written into the test). All 35 passed for real when actually executed in this build process — genuinely run, not just syntax-checked. Also worth naming if asked "does every N days count from today or from some start date I pick" — there's no separate start-date field; a habit's own creation day is day 0 of its own interval, which is worth saying plainly rather than letting someone assume otherwise.

---

## 30. Focus sessions feed task duration back

**What it shows:** the "how long did this actually take" prompt stops making you guess — if you actually ran a focus session on that task, it already knows.

- On `/today`, tap a task's "Focus" link, start a real focus session, and complete it after some real time passes.
- Go back to `/today` and check that task off. The "How long did &quot;X&quot; actually take?" prompt now shows the real number already filled in, with a small "From your focus sessions on this task" note underneath.
- Change the number, or hit Skip — both still work exactly as before; the pre-fill is a starting point, not a locked-in answer.

**Talking point:** worth being upfront that this only pre-fills a *suggestion* — the field was always a plain editable text input, and still is; nothing here silently applies a number without the person seeing and being able to change it first. If asked "what if I worked on it in two different sittings," the honest answer is it adds both real, completed sessions together — that's the more accurate total, not a bug. And if asked why this doesn't run on every task row automatically: it's a genuinely cheap local query, but it still only ever runs the moment someone taps the checkbox to complete a task, not speculatively for a task nobody's finishing yet.

---

## 31. Weekly/monthly plans protecting habits across the window

**What it shows:** a Week or Month plan now protects *every* day a habit is due across the whole window it's generating — not just today's occurrence, which is all it used to check.

- Create or use a habit that recurs on a specific day later this week (e.g., a WEEKLY habit on a weekday that hasn't happened yet), with a preferred time and a protected duration.
- Go to the **Longer-range plan** card, toggle to **Week**, and click **Generate**. Ask the AI to propose something that would land on top of that future day's protected habit window.
- Point out the plan either avoids that slot on its own, or — if you force a colliding proposal — gets rejected by the same deterministic check that already protects FIXED calendar events, with a summary line naming "protected habit time." This isn't the AI being asked nicely; it's enforced independently of whatever the AI actually proposes.
- Toggle to **Month** and repeat with a MONTHLY habit due later in the month (e.g., a specific date, or "last day of the month") — same protection, now checked across roughly 30 days instead of 7.

**Talking point:** the honest history here is that this protection already existed and always worked correctly for *today* — Week and Month plans were quietly only checking whether a habit was due today, then applying that same one day's protected window across the whole multi-day proposal. So a habit due on day 4 of a week-long plan was never actually protected before this fix. Nothing about the enforcement mechanism changed — it's the same overlap check against FIXED calendar events and protected habit intervals as always; the fix was making the habit lookup itself loop across every day in the window, not just check "today," mirroring the same per-day loop Insights' habit-streak calculation already used elsewhere in this codebase. DAY-scope plans are provably unaffected — a one-day window reduces to exactly the same single day's check as before. Backed by two new backend e2e tests (one WEEK-scope, one MONTH-scope) that create a habit due several real days out and confirm a colliding AI proposal actually gets dropped — not just checked by hand against the source.

---

## 32. Automatic Pomodoro work/break cycling

**What it shows:** the focus timer stops being a single manual countdown — flip on Pomodoro mode and it chains work and break blocks together on its own, the classic 25/5/15 cadence.

- Go to **Focus**, check the **🍅 Pomodoro mode** toggle. The duration presets disappear (Pomodoro mode always uses a fixed 25-minute work block), replaced by a one-line summary of the cadence.
- Click **Start Pomodoro**. Point out the "Focus block 1 · long break after every 4" label above the countdown.
- Click **Complete** early rather than waiting out the real 25 minutes — a break starts automatically, no second click, no "Start" button anywhere. Point out the heading now says **Break**, and the button says **Skip to next** instead of **Complete**.
- Click **Skip to next** — back to work automatically, now on "Focus block 2."
- Click **Cancel** — point out this fully exits Pomodoro mode (the toggle unchecks itself), rather than leaving the chain half-engaged.
- If you have a few extra minutes and want to show a real long break: run through 4 real (or early-completed) work blocks in a row and point out the 4th break says **Long break** instead of **Break**.

**Talking point:** worth being upfront about the one real scope cut here — the automatic chain and which cycle you're on live in the browser's own React state, not on the server, so a page reload mid-run resets the chain and the cycle counter back to the start; the *in-progress timer itself* still always resumes correctly after a reload exactly like it always has, that part never changed. Also worth naming if asked: a break is never tied to a task, and never counts toward "how long did this actually take" on a task, the focus-session consistency chart in Insights, or the chronotype signal that learns when you tend to focus — all three were updated to filter to real work blocks only, specifically because Pomodoro mode doubles the raw number of focus-session rows (one break for every work block), and letting rest time quietly count as focused time would have skewed all three. If asked "what if my tab closes mid-cycle" — the honest answer is the chain just stops advancing; nothing is lost (the session that was actually in progress is still a real, saved row), you'd just need to tap through the rest manually or start a fresh Pomodoro run.

---

## 33. AI recommendations acting on your behalf

**What it shows:** a recommendation stops being just something you read — each one now has a real, one-tap action next to it, not just a dismiss.

- On Today, click **Get recommendations** (or **Refresh** if some are already showing).
- Point out each suggestion now has two buttons: a real action button (**Take this break** for a Break suggestion, **Book this workout** for a Workout suggestion, **Add as a task** for a Meal suggestion) alongside the existing **×** dismiss.
- Click the action button on a **Break** suggestion — you land on **Focus** with a real 15-minute break already counting down, no second "Start" click anywhere. Point out this is a longer, standalone break than Pomodoro mode's own 5-minute one — this isn't part of a work-cycle chain, it's a genuine recovery break.
- Click the action button on a **Meal** suggestion instead — point out the confirmation text ("Added to today's tasks") and then scroll down to Today's task list to show the real new task sitting there, titled with the AI's own suggestion.
- If a **Workout** suggestion shows up, click its action button too — you land on **Calendar** with a real 30-minute block already placed, starting right now, titled with the AI's own suggestion (see the Booking a workout as a real calendar block section below for the full walkthrough of this one).
- Try acting on a suggestion twice, or try acting on a Break suggestion while another focus session is already running, to show the honest error handling (a clear message, not a silent failure or a duplicate action).

**Talking point:** worth naming directly if asked why this only reverses the "propose-only" precedent for these three things and not everywhere else in the app — AI plan review (Accept/Reject/Edit a whole schedule) and AI chat (advice only) both stay propose-only on purpose, since a wrong one-tap "yes" there is a much bigger deal than starting a break, booking a block, or adding a task, all of which are easy to undo (cancel the break, delete the calendar event, delete or edit the task). Worth being honest about the Meal action's real scope: there's still no meal log anywhere in this app, so "acting on" one just creates a plain task with the suggestion's own wording, picked up by the AI planner from there like anything else. And a nice, mostly-accidental payoff worth pointing out: the "Take this break" action only exists at all because of the Pomodoro increment's own `kind: BREAK` field — a real recommendation now flows into the exact same domain a Pomodoro break does, not a separate one-off timer.

---

## 34. Habit-edit UI

**What it shows:** every field a habit can be created with can now be changed afterward too — recurrence, preferred time, protected duration, and goal link — plus a real way back from Deactivate.

- On **Habits**, click **Edit** on any habit. Point out the exact same recurrence picker from creation appears, pre-filled with the habit's current shape (whichever of the six it currently uses).
- Change the recurrence entirely — e.g. switch a daily habit to specific weekdays — plus the preferred time and protected duration, then **Save**. Point out the row updates immediately with the new label.
- Open **Edit** again and change (or clear) the linked goal via the dropdown — point out it offers every goal, not just active ones, so a habit already linked to a since-completed goal still shows that link correctly when you open the editor.
- Click **Edit**, change something, then **Cancel** — point out the row reverts, nothing was saved.
- Click **Deactivate** on a habit, then point out the new **Reactivate** button that appears in its place — click it and show the habit is back to normal (no longer struck through, back in the plan).

**Talking point:** the honest surprise here, worth leading with if asked "how long did this take" — the backend mutation (`updateHabit`, full recurrence support, validation, everything) already existed before this increment started; it just had zero frontend calling it and zero tests, a real gap between "built" and "shippable" this README had been naming for a while. The actual new work was almost entirely frontend, plus two small backend additions the edit screen needed: the goal link becoming editable (`goalId` was missing from the update input specifically, even though every other field was already there), and a brand-new `reactivateHabit` mutation, since deactivating used to be a real one-way trap — there was no mutation anywhere that could flip a habit back on, unlike a Goal, which already moves between Active/Completed/Abandoned freely. If asked about the recurrence picker specifically: it's not two separate implementations that happen to look the same — it's one shared component now used by both the create form and the edit form, specifically to avoid two copies of six-shape recurrence logic quietly drifting apart over time.

---

## 35. Configurable Pomodoro durations

**What it shows:** Pomodoro mode's cadence stops being a fixed 25/5/15-every-4th constant — a person can now set their own work length, short break, long break, and cycle count from Settings, and Focus mode actually uses them.

- Go to **Settings**, scroll to the new **Pomodoro durations** section. Point out four plain number fields, each with the classic default shown as a placeholder (25/5/15/4).
- Set some real custom numbers — e.g. 45-minute work blocks, an 8-minute short break, a 20-minute long break, every 3rd cycle — then **Save settings**.
- Go to **Focus**. Point out the Pomodoro toggle's own one-line summary now reads back the real custom numbers, not 25/5/15/4, and the Start button itself says "Start Pomodoro (45-minute blocks)."
- Start a Pomodoro run and complete a block early — point out the break that starts automatically is the new 8-minute short break, not the old fixed 5.
- Clear one field back to blank on Settings and save again — point out only that one number reverts to its classic default on Focus, the other three stay custom.

**Talking point:** worth naming directly what changed vs. what didn't — the cadence numbers themselves are now real, per-user, server-stored settings (four nullable columns on `User`, `null` meaning "use the classic default," the same convention `workHoursStart`/`workHoursEnd` already established), but the automatic chain itself — whether Pomodoro mode is currently on, and which cycle you're on — is still client-side React state, same as before this increment; that's a separate, still-open scope cut, not something this increment touched. Also worth pointing out if asked "why does this live on Settings and not Focus itself" — the same reasoning as work hours and quiet hours: a setting you'd tune once and rarely touch again belongs on the dedicated settings screen, with just a small "Customize →" link from Focus itself so it's still discoverable from where it's actually used.

---

## 36. Booking a workout as a real calendar block

**What it shows:** acting on a Workout recommendation stops landing as an unscheduled task — it places a real, timed block right on the calendar, the same real domain a Break recommendation already gets.

- On Today, click **Get recommendations** (or **Refresh**) until a **Workout** suggestion shows up (regenerate a couple times if the AI doesn't offer one on the first try — it only suggests categories that actually fit the day).
- Click **Book this workout**. You land on **Calendar** with a real 30-minute block already sitting there, starting right now, titled with the AI's own suggestion.
- Point out the block behaves like any other calendar event from here — it can be dragged/edited/deleted from Calendar like a manually-added one, since it's a real `CalendarEvent` row, not a special read-only type.
- Worth showing side by side if you demoed Break and Meal earlier in this same run: three suggestions, three genuinely different real actions — a timer, a calendar block, and a task — not one generic "do something" button underneath.

**Talking point:** the honest scope cut worth naming directly — this books straight onto "right now" with no check against whatever else might already be on the calendar at that moment; if something's already booked in that exact half hour, the two blocks simply overlap on `/calendar` rather than one deferring to the other. That's a deliberate "act immediately, don't ask a follow-up question first" choice, the same one Break's own 15-minute timer already made — not something this increment introduced fresh. Also worth mentioning if asked about the underlying schema: `CalendarEvent.isAiFocusBlock` was actually a real column sitting unused in this app's database since a much earlier increment — reserved for exactly this kind of "the AI placed this, not a person typing it by hand" case — and this is the first time anything in the codebase has ever actually set it to `true`.

---

## 37. Configurable reminder windows/thresholds

**What it shows:** the five numbers that decide when a reminder fires — morning/evening routine hour, reflection hour, and the habit-overdue window — stop being hardcoded and become real per-person settings.

- Go to **Settings**, scroll to the new **Reminder times** section. Point out three hour fields (morning routine, evening routine, reflection) and a min/max pair for how overdue a habit needs to be, each with the classic default shown as a placeholder (8/20/21, 15/120).
- Set some real custom numbers — e.g. morning routine at 6, evening routine at 19, reflection at 22, habit window 30–90 minutes — then **Save settings**. Reload the page and point out they're really persisted, not just held in the form.
- If you want to show the actual firing behavior live, this is the one increment in this whole walkthrough that can't be demoed by clicking a button — reminders fire from a real 15-minute cron sweep in the backend, not a user action. Mention this honestly rather than trying to fake it: the backend e2e suite proves a custom hour genuinely replaces the old default (checked at the *old* default time too, where it correctly no longer fires) — walk through that test in `app.e2e-spec.ts` if someone wants to see it proven, rather than staged live.
- Try saving a minimum overdue value that isn't less than the maximum (e.g. 90 then 60) — point out the clear inline error, not a silent failure or a confusing generic message.

**Talking point:** worth naming directly if asked "why can't I see this fire on screen" — this is the one setting in the whole app whose effect is entirely invisible in the moment; the payoff shows up later, as a real push/email/SMS notification at the hour you chose instead of the one this app used to hardcode. Also worth mentioning as a fun aside if it comes up: while building this exact increment, the previous two increments' own "stale Prisma client" caveats in this README's own build log resolved live, in real time, mid-build — the moment a real `npx prisma generate` ran on a real machine sharing the same mounted project folder, this sandbox's own type-checker picked up the regenerated client immediately, the same kind of before/after confirmation this project has documented once before (see the Link habits to goals increment), just caught happening this time instead of reconstructed afterward.

---

## 38. Customize act-on defaults at the point of acting

**What it shows:** the one-tap action buttons on AI recommendations still commit instantly with sane defaults, but each suggestion now has a small **Customize →** disclosure that lets a person override the specifics first — break/block length, when a workout block starts, or a task's priority and due date.

- On Today, get a fresh set of recommendations. Click **Customize →** under any suggestion — a small inline panel opens below the row with fields specific to that suggestion's category.
- For a **Break** or **Workout** suggestion: change the length (default 15 or 30 min shown as a placeholder), and for Workout specifically, change the start time too (pre-filled to right now). Click **Confirm & take this break** / **Confirm & book this workout** — point out the real countdown or calendar block reflects the custom number, not the old fixed one.
- For a **Meal** suggestion: change the priority (e.g. to Urgent) and set a due date. Click **Confirm & add as a task**, then show the new task on Today with the real "Urgent" label — a real custom value, not just an echoed input.
- Point out the plain action button next to Customize still works exactly as it always has — clicking it directly, without ever opening Customize, still commits with the same fixed defaults every prior increment already built.

**Talking point:** the deliberate constraint worth naming directly — the one-tap button's own default behavior was never touched by this increment; Customize is purely an optional, additive detour, not a replacement for the fast path. That was a real design decision, not just how it happened to turn out: this feature's whole point since the AI recommendations acting on your behalf increment has been "one tap, no second form," and the easy version of "add customization" would have been to always show a form before committing — deliberately rejected, since that would have slowed down the common case (the defaults are usually fine) to serve the uncommon one. If asked "what if my custom workout time collides with something" — that's now handled too, see the next section below.

---

## 39. Workout-booking conflict avoidance

**What it shows:** a workout no longer books straight on top of whatever's already there — it finds the next real open slot instead, whether it's booking at the default "right now" or a custom time picked through Customize.

- On **Calendar**, add a real event starting a few hours from now (e.g. "Team sync," 2:00–2:30pm).
- On Today, get recommendations until a **Workout** suggestion shows up. Click **Customize →**, set the start time to exactly 2:00pm (the same time as the event you just added), and confirm.
- Land on **Calendar** and point out the new workout block didn't overlap the Team sync event — it landed right at 2:30pm instead, the moment the conflict cleared.
- Mention this also applies to the plain one-tap **Book this workout** button with no customization at all — the check runs every time a workout is booked, not just when someone picks a custom time.

**Talking point:** worth naming the one real judgment call here if asked — this uses a more literal definition of "conflict" than the AI daily/weekly planner does elsewhere in this app. The planner only treats a calendar event marked FIXED (`isImmovable`) as a real blocker when placing tasks — an ordinary event is fair game to schedule around — but this feature checks against *every* calendar event, FIXED or not, since the whole point here is "don't visually double-book this half hour," a more everyday, literal reading of the word. Also worth being upfront about the graceful-failure case: if someone's calendar is somehow booked completely solid for a full week straight, this gives up quietly and books at the originally-requested time anyway rather than failing the action outright — an extreme, unlikely scenario in practice, but handled deliberately rather than left to throw an error.

---

## 40. Reminder escalation / second nudge

**What it shows:** a habit reminder that's gone completely unread doesn't just quietly stop after its original window closes — hours later, if it's still unread, a second, distinct nudge fires.

- There's no click-through demo for this one — it's a time-driven backend behavior with no dedicated UI, the same honest limitation the Scheduler/reminders section itself has always had (no on-screen "trigger the sweep now" button exists). Show it from the source instead: open `scheduler.service.ts`'s habit loop and walk through the two checkpoints — the original 15–120 minute (or custom, per-user) window firing `habit_reminder:{habitId}`, and the new second checkpoint 4 hours past that window's own ceiling, which only fires `habit_reminder_escalation:{habitId}` if the original is confirmed still unread via a real read (`NotificationsService.isUnreadType`), not just assumed.
- If there's time, point to the backend e2e test that exercises this against the real scheduler and a real database: drives one habit through all three states in sequence — inside the window (fires), the dead zone just past it (correctly silent), and well past the escalation threshold (the second notification appears) — plus a second test proving marking the original read beforehand suppresses the escalation entirely.

**Talking point:** the one real nuance worth naming if asked "so does this mean it was spamming pushes every 15 minutes before this increment" — yes, technically, and this increment didn't change that: `NotificationsService`'s existing "batched" comment refers to not creating a *second database row* for a repeat notification, not to suppressing repeat real push sends — `WebPushService` has no rate-limiting of its own, and a habit sitting in its overdue window already got a real push resend on every 15-minute check before this increment ever existed. The escalation notification added here inherits that same characteristic rather than introducing a new one — a real, pre-existing behavior worth being honest about rather than implying this increment somehow fixed it, since actually fixing it would mean touching `create()`'s delivery logic for every notification type in this app, a separate and larger piece of work than "add a second nudge."

---

## 41. Real-time chat streaming

**What it shows:** a Chat reply now grows into view as the AI actually generates it, over a real GraphQL subscription — not one "Thinking…" spinner followed by the whole answer appearing at once a few seconds later.

- On **Chat**, ask a real question ("What should I focus on today?"). Point out the reply bubble filling in progressively, word by word, rather than popping in all at once.
- Open a second browser tab on Chat at the same time and send a different message from each — point out each tab's own reply streams independently and correctly, never showing the other tab's words. (This is the concurrent-delivery correctness the backend e2e suite checks directly — see below.)
- If asked how this works under the hood: a client-generated id correlates one in-flight send with one subscription (opened *before* the AI call even starts, since a brand-new chat has no conversation id yet), the backend parses Anthropic's real server-sent-events stream as it arrives and publishes each real chunk of text to that id over a `graphql-ws` WebSocket, and the final persisted message (once the whole reply is done) seamlessly replaces the locally-accumulated streaming bubble.

**Talking point:** worth being upfront about the one real architectural call here if asked "why not just poll" or "why not a plain REST endpoint" — REST was never actually on the table for this: the API Design Document reserves this codebase's small REST surface specifically for third-party webhook callbacks (the Google/Microsoft OAuth redirects), not authenticated user traffic, so a real GraphQL subscription over WebSocket was the only choice consistent with that existing boundary — and it's also exactly what the API Design Document's own chat design already called for, not a new architectural decision invented for this increment. The pub/sub behind it is a plain in-memory one (no Redis), the same "simplest correct in-process equivalent" choice already made for the scheduler — meaning, if asked, this specific piece wouldn't survive running more than one backend instance without dropping some mid-stream chunks, a real, named, documented limitation rather than a silent one.

---

## 42. Tool-calling actions in Chat

**What it shows:** the AI in Chat can now actually do things when you ask — add a task, mark one complete, or move one to a new time — not just talk about them.

- On **Chat**, ask something concrete: *"Add a task to call the dentist tomorrow, priority high."* Point out the reply: a short lead-in ("Sure, adding that…"), then a distinct centered "✓ Added task: ..." pill — visually different from a normal spoken reply — then a closing confirmation.
- Open **Tasks** and show the real task is actually there, with the right title and priority — not just an AI claim.
- Try one more, referencing something already on the list: *"Mark [an existing task's title] as done"* — same shape, and the task really flips to completed on **Tasks**.
- If there's time, try asking it to do something outside its three real actions (e.g. "delete my oldest goal") — point out it says plainly it can't do that and points you back to the app, the same honest boundary Chat has always had for anything outside its real capabilities.

**Talking point:** the one real safety detail worth naming if asked "so does it just trust whatever the AI says" — no: every tool call is re-validated server-side exactly the way the AI daily planner's own proposals already are (`PlannerService.validateAndClamp`) — a task id has to be real and actually owned by the person asking, and a reschedule gets checked against real fixed calendar events and refused (with a clear explanation, not a silent double-booking) if it collides with one. If asked "why only these three actions" — they're the same three AI recommendations acting on your behalf already covers from its own suggestion cards; this increment makes them reachable a second way, by just asking, rather than expanding what the app can do into new territory.

---

## 43. Expanded tool set for Chat

**What it shows:** Chat's real actions grow from three to seven — the AI can now also log a mood or energy check-in, add a calendar event, and save a memory fact, all from a plain sentence, on top of the create/complete/reschedule task actions from the increment above.

- On **Chat**, try each of the four new ones: *"I'm feeling pretty good today, energy's high too"* (watch for two pills — a mood check-in and an energy check-in), *"Add a dentist appointment to my calendar for tomorrow at 2pm to 3pm"* (a calendar-event pill), and *"Remember that I prefer morning workouts"* (a memory-fact pill).
- Confirm each one actually landed: check-ins show up on **Today**'s mood/energy widgets, the calendar event is really on **Calendar**, and the memory fact is really listed on **Memory**.
- Worth trying one deliberately-invalid case if there's time: ask it to add a calendar event with an end time before the start time — point out it explains the problem in plain language rather than silently creating a broken event.

**Talking point:** the one nuance worth naming if asked "does saying 'I've been tired lately' log an energy check-in" — no, and that's deliberate: each check-in tool's own description explicitly tells the model to only fire on an actual real-time report of how someone feels right now, not mood or energy merely coming up in conversation, the same "don't over-trigger on a passing mention" guard the `create_task` tool already had for tasks mentioned only in passing. Also worth naming if asked about the calendar-event tool specifically: it doesn't check for conflicts, on purpose — that matches the plain "add an event" button elsewhere in the app, which has never checked for overlaps either; only a task *reschedule* checks against fixed calendar events, since that's a different, narrower, already-established case (moving something existing, not adding something new).

---

## 44. Screen-reader pass

**What it shows:** a real manual accessibility audit closing the gap the automated axe-core scan (see the accessibility (WCAG AA) pass, below) structurally can't cover — missing ARIA state on toggles and tabs, incomplete live regions, and no focus management through the onboarding wizard.

- There's no single click-through demo for this one — it's a set of DOM/ARIA fixes across many components, most invisible unless you're using a screen reader or inspecting the accessibility tree. The most concrete thing to show live: open browser dev tools' Accessibility panel (or the Elements panel) on **Tasks**, click between the Open/Cancelled tabs, and point at `aria-selected` flipping on the underlying `<button role="tab">` elements — previously that state existed only as a color change.
- On **Today**, check off a habit and point out `aria-pressed` flipping to `true` on its checkbox in the Accessibility panel — same for tapping a mood or energy score.
- On **Chat**, ask a question and open the Accessibility panel's "sr-only" region near the top of the page — point out it stays empty while the reply streams in, then fills with the complete text once streaming finishes, a single batched announcement rather than one per token.
- If asked to see the onboarding fix specifically: revisit `/onboarding` (or open dev tools and watch focus move) — each step change now moves keyboard/screen-reader focus to that step's own heading.

**Talking point:** the one thing worth being fully upfront about if asked "so is this screen-reader tested now" — no, not with a real screen reader. There's no macOS/Windows GUI in this build sandbox to run VoiceOver, NVDA, or JAWS on, so this was a rigorous manual audit against WAI-ARIA guidance and the computed accessibility tree (verified with Playwright's own role-aware locators, which read from the same tree a screen reader does), not an audio-verified pass. That's a real, substantive improvement over the pre-pass state, but a real screen reader run is still the single most valuable accessibility check left to do on this app.

---

## 45. Real Stripe billing integration

**What it shows:** the Plan picker on Settings now starts a real Stripe Checkout session and hands off to Stripe's own hosted Billing Portal afterward — not the old instant simulated tier flip (still there, but now only as the fallback for a server with no Stripe keys configured).

- On **Settings**, scroll to Plan and click Plus or Pro. In this build (no real `STRIPE_*` keys configured anywhere in this sandbox), point out what actually happens: a real `createCheckoutSession` GraphQL call goes out first, the server genuinely reports `STRIPE_NOT_CONFIGURED`, and only then does it fall back to the original simulated switch — open the Network tab if asked to prove it's a real round trip, not a UI-only shortcut.
- If asked "so does this actually work with real Stripe" — walk through what a real run looks like rather than faking one: with real Stripe test-mode keys set in `.env`, clicking Plus would do a full browser redirect to Stripe's own real Checkout page (a real hosted form, test card `4242 4242 4242 4242` works), then redirect back to `/settings?checkout=success` — at which point the account is still on Free for a few seconds until Stripe's real webhook arrives and the real `/webhooks/stripe` endpoint (open `apps/backend/src/billing/stripe-webhook.controller.ts` to show it) verifies the signature and writes the new tier for real.
- Once a real Stripe customer exists, point out the Plan buttons go read-only and a new "Manage billing →" button appears instead — pointing at Stripe's own hosted portal for upgrades/downgrades/cancellation, rather than this app reimplementing proration logic.

**Talking point:** the one thing worth being fully upfront about if asked "did you actually test this against Stripe" — no real Stripe account exists in this build sandbox, so no real Checkout session has ever been completed and no real webhook has ever arrived from Stripe's own servers. What *is* real and verified: the webhook signature-verification code (the trickiest, most security-sensitive part) was run against the actual `stripe` npm SDK's real cryptographic signing/verification functions in a standalone script and in backend e2e tests that post genuinely-signed payloads over real HTTP to the real webhook endpoint and confirm the real database updates — a tampered signature is genuinely rejected, a validly-signed one genuinely isn't. Getting a real Stripe test account, setting the four `STRIPE_*` env vars, and clicking through one real Checkout session with a real Stripe test card is the single most valuable thing left to check on this whole increment.

---

## 46. Fuller habit recurrence

**What it shows:** the two gaps the Full custom habit recurrence section above used to name explicitly — "every N months," and a habit that ends after a fixed number of times or on a date instead of recurring forever — are both closed now.

- On **Habits**, start a new habit, pick "Monthly," and point out the new "Every [N] months" field sitting next to the existing day-of-month/weekday controls — set it to 3 and create it; the row now reads "Every 3 months on the 1st" instead of just "Monthly."
- Still on the create form, scroll to the new "Ends" control below the recurrence picker — Never / After N times / On a date, shown for every frequency, not just monthly. Pick "After N times," set it to 5, and create the habit — its row now shows "· 5 times total" appended after the recurrence description. Try "On a date" instead and point out the "· until YYYY-MM-DD" suffix.
- Edit an existing habit (the same Edit flow from the Habit-edit UI section above) and switch its end condition from "After N times" to "On a date" — point out the old count is gone the moment the date is set, not something you have to separately clear.
- If asked how `COUNT` actually stops a habit: it's occurrence-based, not calendar-day-based — a "count: 10" habit on an "every 3 days" cadence is due 10 *times*, not for 10 days, and that math (`rrule.spec.ts`, 61 passing tests) is exhaustively unit-tested even though it can't be demoed live in a single sitting without days actually passing.

**Talking point:** the honest state of verification here is more specific than usual. The recurrence math itself (all 61 unit tests, including every new `COUNT`/`UNTIL`/every-N-months case) was run for real in this build sandbox and passes. The new backend e2e tests and Playwright specs, though, could not be run for real this session — not because of the usual "no reachable Postgres" limitation alone, but because this particular sandbox has no Postgres installed at all, and separately, regenerating a Linux-compatible Prisma query engine failed outright because this environment's network allowlist blocks `binaries.prisma.sh` (confirmed with a direct request, not assumed) — the only query engine present was built for Windows. That's a stricter version of a limitation this project has named before, not a new kind of one; the new tests were written and syntax/type-checked, and are ready to run for real the moment someone runs them on a normal machine with `npx jest --config test/jest-e2e.json` and `npx playwright test`.

---

## 47. BYSETPOS / multiple weekdays per month

**What it shows:** the last two named gaps in habit recurrence — several specific days of the month in one rule ("the 1st and 15th"), and "the last weekday of the month" (genuinely different from "the last *Friday*") — are both closed now.

- On **Habits**, start a new habit, pick "Monthly," and point out there are now four mode buttons instead of two. Click "Several days" — a 1-31 grid of toggle buttons appears; pick the 1st and the 15th and create it. The row reads "Monthly on the 1st, 15th."
- Click "A set of weekdays" instead — the same Mon-Sun toggle-button row the "Specific days" frequency already uses, plus the same first/second/third/fourth/last dropdown NTH_WEEKDAY already has. Pick "last," toggle on Mon through Fri, and create it. The row reads "Monthly, last Mon/Tue/Wed/Thu/Fri day" — the actual last weekday of the month, whichever day of the week that turns out to be.
- If asked how this differs from the existing "3rd Tuesday" pattern: that shape picks one specific weekday's Nth occurrence; this one counts across an entire *set* of weekdays together. "The last weekday of the month" and "the last Friday of the month" are usually different dates — point out August 2026 specifically if asked for a concrete example: the last weekday is Monday the 31st, the last Friday is the 28th.

**Talking point:** same specific, honest limitation as the Fuller habit recurrence section directly above — no Postgres installed in this sandbox session, and a blocked network path to a Linux Prisma engine, so the new backend e2e tests and Playwright specs were written and syntax/type-checked but never run for real here. What *did* run for real: `rrule.spec.ts` grew from 61 to 77 passing unit tests, including one that specifically proves "last weekday" and "last Friday" land on genuinely different real dates, not just two names for the same check.

---

## 48. Diagnostic quiz free-text answers

**What it shows:** the onboarding quiz's first genuinely open-ended question — everything else in the quiz is still a fixed preset card, but this one is a real text box, and what's typed there actually reaches the AI.

- Go to `/onboarding` directly (or use the "redo onboarding" link from Settings, covered at step 24). Scroll to the bottom of the quiz — below "What's your biggest source of overload right now?" there's now a text box: "Anything else the AI should know about you right now? (optional)". Type something concrete, e.g. "Training for a marathon in October," and hit Continue.
- Open **Memory** (`/memory`) afterward and point out the new fact: "Additional context from onboarding: Training for a marathon in October." — sitting right alongside the "Biggest current source of overload" fact the existing overload question already writes, both editable/deletable there like any manually-added memory.
- If asked "does the AI actually see this" — open **Chat** and ask something where it'd plausibly matter (e.g. "what should I focus on this week"); the free-text answer is injected into the same memory-context block every chat/planning prompt already reads, no separate wiring needed for it to show up.
- Redo the quiz with a different free-text answer to show it updates the one fact in place rather than creating a second one — same behavior the overload-source question already had.

**Talking point:** the free-text answer is stored exactly as typed, no AI summarization step in between — a deliberate choice given the field is capped at 500 characters, short enough that raw injection doesn't bloat any prompt, and summarizing someone's own words back to them risked quietly changing what they said. Verification-wise: two new backend e2e tests (independent-fact creation, and the same redo-updates-in-place behavior the overload question already has) and a new Playwright spec (typing into the real textarea and confirming the quiz advances) were all written and syntax/type-checked, but — same specific sandbox limitation as the two habit-recurrence entries above — never run for real here.

---

## 49. Free time picker for quiz's work/quiet hours

**What it shows:** the other real ceiling on the diagnostic quiz's precision — work-hours and quiet-hours questions used to offer only a handful of preset times each; now they're real time pickers, same as Settings and Notifications already use elsewhere.

- Go to `/onboarding` directly (or the "redo onboarding" link from Settings). The "What time do you usually start/stop work?" and "When should we stay quiet?" questions no longer show a grid of preset cards — each is now a real "From ___ to ___" pair of clock/time inputs.
- Type a genuinely non-preset time — say work starting at 6:30am — and point out that was never selectable before this increment (the old presets jumped 6:00 → 7:00 → 8:00...). Set quiet hours from 9:15pm to 5:50am the same way, then hit Continue and confirm the quiz advances normally.
- If asked "did the backend need to change for this" — no, and that's worth pointing out: `CompleteOnboardingInput` already validated these four fields against a real `HH:mm` regex, not an enum of presets, so a non-preset value was always going to be *accepted*; it just could never be *typed* until now. Redo the quiz afterward to show the exact values you entered pre-fill back in, not the nearest preset.

**Talking point:** same specific, honest limitation as every recent entry above — no Postgres and a blocked Prisma engine download in this sandbox session, so the new backend e2e test (submitting and re-reading four non-preset `HH:mm` values) and the new Playwright test (filling all four real time inputs and confirming the quiz advances) were both written and syntax/type-checked, but never run for real here. A full syntax sweep across everything touched this session (`apps/backend/src`, `apps/backend/test`, `apps/web/src`, `apps/e2e/tests`) came back clean at 267 files, 0 diagnostics.

---

## 50. Fix onboarding calendar-connect redirect

**What it shows:** connecting Google or Microsoft Calendar from inside the onboarding wizard no longer drops you out of it onto the full `/calendar` page — and a second, subtler bug found while fixing that one (landing back on the quiz step instead of the calendar step) is closed too.

- Go to `/onboarding` directly, reach the "Connect your calendar" step (thanks to the Resumable onboarding wizard increment below, a completed dev account often lands straight there already — if it instead shows the quiz, hit Continue once to get to the calendar step), and click **Connect Google Calendar** (or Microsoft). If you don't have real Google/Microsoft OAuth credentials configured on the server, you'll hit the "Couldn't connect" error screen after the redirect — that's expected and fine for this demo; the point is *where* it lands you.
- Point out the URL bar: it comes back to `/onboarding`, not `/calendar` — and specifically to the calendar step, not bounced back to the quiz. If asked why that second part was ever a risk: `onboardingCompletedAt` gets stamped the moment the quiz step submits, well before the calendar step is even reached — so the wizard's own "already done the quiz → skip to it" default for a returning visitor would have fired the instant you landed back here, without the fix.
- If asked "how does the backend even know to send me back to `/onboarding` and not `/calendar`" — the signed OAuth `state` param (the one that already proved which user this callback belongs to) now optionally carries a `returnTo: 'onboarding'` hint too, whitelisted server-side so nothing else the client sends is ever honored — a concrete, small example of not trusting client input even for something as low-stakes as picking a redirect page.

**Talking point:** the strongest verification in this specific increment is real, not just syntax-checked — `oauth-state.spec.ts`'s 11 tests (round-tripping the new `returnTo` field, and five new tests for the non-verifying `peekReturnTo` helper specifically) don't touch Prisma or the database at all, so they actually ran in this sandbox and passed. The new backend e2e describe block (four tests hitting the real `/auth/google/callback` and `/auth/microsoft/callback` REST endpoints directly) and the new Playwright test were both written and syntax/type-checked but hit the same standing no-Postgres limitation as everything else this session — worth noting, though, that unlike most calendar-sync e2e coverage, these four tests were deliberately designed to never need a real Google/Microsoft API call or real credentials to prove the fix, so they're a good bet to just pass the first time you run them for real.

---

## 51. Resumable onboarding wizard

**What it shows:** closing the tab (or just typing `/onboarding` again) after reaching the calendar-connect or First-plan step now resumes exactly there — tracked for real on the server, not lost the moment the browser tab closes.

- Go to `/onboarding?redo=quiz` (the same URL Settings' own "Redo the onboarding quiz →" link now uses), answer nothing, and hit Continue to reach "Connect your calendar." Then just reload the page — plain `/onboarding`, no query string at all — and point out it lands right back on "Connect your calendar," not the quiz. That's the exact bug this closes: before this increment, that same reload would have bounced back to the quiz step every time.
- Click Continue again to reach "Your first plan," reload once more, and show it resumes there too.
- If asked "how is this different from the Re-enter onboarding increment that already let you redo the quiz" — genuinely different mechanism and different purpose: that one is for deliberately editing old answers (always shows the quiz, on purpose); this one is for picking back up an *interrupted* first-time walkthrough, and specifically does *not* show the quiz again unless asked to (`?redo=quiz`). Worth being upfront that reconciling the two took a real design decision — see the talking point below.

**Talking point:** be honest if asked about the trade-off this required: plain `/onboarding` used to always mean "show me the quiz" (the Re-enter onboarding increment's whole point); it now means "take me back to where I left off" instead, which is a real behavior change. The fix was giving the Settings link its own explicit `?redo=quiz` marker so redoing the quiz stays exactly as reliable and discoverable as before — a small, concrete example of two good features colliding and needing a deliberate resolution, not a silent breakage. Verification-wise: three new backend e2e tests (completing the quiz always stamps `CALENDAR`, the calendar step's Continue advances it to `PLAN`, and redoing the quiz resets it back to `CALENDAR` even from `PLAN`) and two new Playwright tests that drive a *real* page reload — not a mock — to prove the resume behavior actually works were all written and syntax/type-checked, but hit the same standing no-Postgres sandbox limitation as everything else this session, so none of them actually ran here. This increment also hit a new wrinkle none of this session's earlier Prisma-touching increments did: the generated Prisma Client's own types are stale relative to the new migration (a real `npx prisma generate` attempt failed with the same `403 Forbidden` as ever), so two small, clearly-commented `as any` casts stand in until that command can run for real.

---

## 52. Free-text "biggest source of overload"

**What it shows:** the diagnostic quiz's last remaining fixed-preset question — "What's your biggest source of overload right now?" used to be five cards (Work & career, Health & fitness, Family & relationships, Just staying organized, Something else entirely); it's a real text field now.

- Go to `/onboarding?redo=quiz`, scroll to that question, and type something none of the five old cards could ever capture — e.g. "Trying to keep up with three side projects and a new puppy." Hit Continue and confirm the quiz still advances normally.
- Open **Memory** afterward and point out the fact reads back exactly what was typed, not the nearest preset category.
- If asked "did the backend need to change" — no, same story as the Free time picker increment right before this one in the build order: `overloadSource` already accepted any string up to 200 characters, never an enum of the five old labels. Worth noting this is the *third* time in a row this exact pattern repeated across the last few increments — a strong sign the backend's own field design was already right, and the presets were purely a frontend UI choice from early on.

**Talking point:** with this, chronotype is the only quiz question still using fixed preset cards — and that one's staying that way on purpose (three genuinely small, natural options; nobody needs a fourth chronotype). Verification-wise: a new backend e2e test proves a genuinely non-preset phrase reaches a real AI Memory fact verbatim, and a new Playwright test types a non-preset phrase and confirms the quiz still advances — both written and syntax/type-checked, but hit the same standing no-Postgres sandbox limitation as every e2e test this session.

---

## 53. Configurable daily reflection questions

**What it shows:** the three fixed daily reflection questions (see Daily reflection above) can now be renamed from Settings — "What went well today?" doesn't have to say exactly that anymore.

- Go to `/settings`, scroll to the new **Daily reflection questions** section, and rename all three — e.g. "Wins" / "Struggles" / "Tomorrow." Save.
- Go to `/reflection` and show the form now asks your own three custom questions, not the classic wording.
- Clear all three fields back to blank on Settings and save again — show `/reflection` reverts to the classic default wording, proving blank genuinely falls back rather than showing empty labels.
- If asked "does this let me add a fourth question or change what gets saved" — no, on purpose: this only renames what's *displayed*. A submitted reflection is still always stored as `{wentWell, challenging, carryForward}`, and the AI summary prompt still always reads the classic fixed wording internally regardless of your custom labels — see the talking point below.

**Talking point:** be upfront about the scope boundary here if asked: the AI summary prompt and Insights both hard-code the same three keys and the same fixed question wording internally, so letting someone rename the *displayed* labels without also rewriting AI summarization and analytics was a deliberate, smaller cut — not an oversight. A new backend e2e test proves this boundary holds for real: it sets custom labels, submits a reflection, and confirms the AI summary prompt still contains the classic fixed strings verbatim, not the custom ones. Also worth noting: this is the third increment in a row to hit the stale-generated-Prisma-client-types issue (`users.service.ts`'s `updateProfile()` now has its own clearly-commented `as any` cast, same shape as the last two increments' own casts), so the same "hasn't run against a real database yet" caveat applies here too. A new Playwright spec (`reflection-labels.spec.ts`) drives the full round trip through a real page navigation — set labels on Settings, confirm them on Reflection, clear them, confirm the defaults return — but like every e2e test this session, it was written and syntax/type-checked, never actually run, due to the standing no-Postgres sandbox limitation.

---

## 54. Journal sentiment analysis

**What it shows:** every journal entry now gets a real AI-scored sentiment when you save it — closes the "Journal sentiment analysis / AI Memory feed" gap named in "What's not done yet" below, and adds a fourth automatic AI Memory signal beyond the three named in the AI Memory section above.

- Go to `/journal` and write an entry with a clearly upbeat tone. Save it, and point out the small "Felt good" label that shows up next to the timestamp (only appears if `ANTHROPIC_API_KEY` is configured — see the talking point below for what this looks like without one).
- Write a clearly rough one and show the label reads "Felt heavy" instead; write something in between and it reads "Mixed."
- If asked "does this feed into Insights" — no, on purpose, and worth being upfront about it: `sentimentScore` doesn't factor into the correlation engine at all yet, a real gap still open (see "What's not done yet" below).

**Talking point:** if there's no `ANTHROPIC_API_KEY` configured in whatever environment you're demoing in, entries still save exactly as before — no error, no broken UI, just no sentiment label, the same honest "AI features degrade gracefully, core actions never depend on them" pattern every other AI-adjacent feature in this app already follows (mirrors the Daily reflection AI summary's own fallback). Mention the second half of the pipeline too: after several entries in a row read clearly positive or clearly negative, the app writes a real `journal_sentiment` AI Memory fact — same statistical discipline (minimum sample size, a real threshold, nothing manufactured from a single mixed entry) as the chronotype/task-duration/plan-response signals already use, and it reaches the same planner/chat prompt context those three already do. Verification-wise: six new backend e2e tests, all against a fake AnthropicClient (no real API key needed) — a scored entry stores the real value, a failed scoring call fails gracefully, sustained negative/positive runs each write the right trend fact, and both "too few samples" and "too close to neutral" correctly write nothing — but like every e2e test this session, they were written and syntax/type-checked, never actually run, due to the standing no-Postgres sandbox limitation. No new Playwright coverage this time — unlike Settings' other configurable fields, sentiment scoring needs a real network call to Anthropic that a black-box browser test can't fake the way the backend's own testing module can.

---

## 55. Real-time calendar updates (webhooks)

**What it shows:** a connected Google or Microsoft account no longer needs a manual "Sync now" tap to pick up a change — closes the "Real-time calendar updates (webhooks)" gap named in "What's not done yet" below.

- This one needs a real, publicly reachable deployment to demo live — with `BACKEND_PUBLIC_URL` unset (the default in any sandbox/localhost setup), skip straight to the talking point below rather than trying to fake it.
- If you *do* have a real deployment with `BACKEND_PUBLIC_URL` set: connect a Google or Microsoft account from **Calendar** (see the Calendar section above), then point out the new "· real-time sync active" badge next to the account's email/last-synced line — that's the honest, on/off signal for whether a real channel/subscription is actually registered right now. Make a change directly in Google Calendar or Outlook (not in this app), wait a few seconds, and refresh **Calendar** here — it should already be there, with no "Sync now" tap.

**Talking point:** be upfront about what this sandbox specifically can't demo: registering a real webhook needs a genuinely public HTTPS address neither providers can reach `localhost` or an internal-only hostname — so in this build environment the badge just never appears, and every connected account keeps working exactly as it did before this increment (manual "Sync now" only). What's worth walking through instead is the verification story, because it's unusually strong for a third-party-integration increment: 31 new unit tests across 6 new spec files were actually written *and run* here via `npx jest` — not just syntax-checked — covering the real request shapes sent to Google/Microsoft's APIs (mocked `fetch`), the registration/renewal/token-refresh logic and the notification-verification logic (mocked Prisma), and both webhook controllers' own early-return and delegation behavior (constructed directly, no Nest bootstrap needed) — all 31 pass. That's possible specifically because the piece that matters most here — "is a notification genuinely about a real, currently-registered channel" — doesn't actually need a database or a live provider account to test, just the network boundary mocked out. What's still only provable with a real deployment: an actual webhook delivery landing here for real.

---

## What to say if someone asks "what's not done yet"

Be direct about this rather than dodging it — it lands better:

- Focus sessions now feed a real, editable suggestion into a task's completion prompt (see the Focus sessions feed task duration back section above) — but only from that one prompt on Today; there's still no dedicated task-edit screen, so there's nowhere else to attach a focus session's real time to a task after the fact.
- Habit recurrence now covers ten real patterns across three increments (see the Full custom habit recurrence, Fuller habit recurrence, and BYSETPOS / multiple weekdays per month sections above) — every day, every N days, specific weekdays, every N weeks, monthly by date, monthly by a specific weekday, every N months, a habit that ends after a fixed count or on a date instead of forever, several specific days of the month in one rule, and "the last weekday of the month" (or any Nth day among a set of weekdays). Still not a full RRULE editor: no `WKST` override, no combining `BYMONTHDAY` and `BYDAY` in one rule — narrow edge cases now, not a clearly-missing pattern. A habit's recurrence can now be changed after creation too — see the Habit-edit UI section above.
- Goals now ladder up from both Tasks and Habits (see the Linking habits to goals section above), and a habit's goal link is no longer create-time only — see the Habit-edit UI section above for changing or clearing it afterward, the same as a task's own goal picker already allows.
- Habits now have a real edit screen (see the Habit-edit UI section above) — title, recurrence, preferred time, protected duration, and goal link can all be changed after creation, and a deactivated habit can be reactivated. Still fixed: the six recurrence shapes are the same six the create form always offered (no new shapes were added), and there's no bulk edit or history of past changes to a habit.
- The scheduler is in-process, not the durable, distributed system the architecture doc calls for (Temporal) — fine at this scale, wouldn't survive a server restart mid-cycle or running more than one backend instance without duplicating reminders.
- Reminder times (8am/8pm/9pm, 15–120 min overdue for habits) are configurable now (see the Configurable reminder windows/thresholds section above) — real per-person settings, defaulting to the classic cadence if never touched. A habit reminder that goes fully unread now gets a real second nudge hours later too (see the Reminder escalation / second nudge section above). Still fixed: the 30-minute width of each catch window, and exactly how much later the second nudge fires (a fixed 4-hour offset past the base window, not yet its own per-user setting).
- Focus sessions now chain automatically in Pomodoro mode (see the Automatic Pomodoro work/break cycling section above), and the cadence itself is configurable now too (see the Configurable Pomodoro durations section above) — work length, short break, long break, and cycle count can all be changed from Settings, defaulting to the classic 25/5/15-every-4th if never touched. Still open: whether Pomodoro mode is on and which cycle you're on is still client-side state that resets on a reload (the in-progress timer itself still always resumes correctly, same as before).
- Week/Month plans now protect a habit's time on every day it's actually due across the whole window (see the Weekly/monthly plans protecting habits across the window section above), not just today's occurrence — the underlying recurrence engine now covers all ten real shapes (see the Fuller habit recurrence and BYSETPOS / multiple weekdays per month sections above), so every one of them is protected too; whatever `rrule.ts` still can't express (`WKST` override, `BYMONTHDAY`+`BYDAY` combined) still can't be protected either.
- Automatic re-planning now covers DAY, WEEK, and MONTH scope, with eight real triggers — task completion, calendar changes, habit completion, a mood/energy check-in, fully finishing a routine, a journal entry, a completed focus session, and a submitted daily reflection. That's every plausible everyday signal this app currently has, aside from sleep logging (deliberately excluded — see the increment note). Each scope has its own cooldown (10 min / 3 hr / 12 hr), and a WEEK/MONTH auto-plan won't visually refresh on Today until that card's own query next re-runs.
- There's now a real on-screen "Auto-generated" pill distinguishing a plan a trigger produced from one you tapped for — see the No visible auto-plan indicator section above. Still open: it's never actually been seen rendering against a real auto-trigger in this sandbox, only checked by hand against the source.
- Real push, email, and now SMS delivery are all wired up (Web Push, Resend, Twilio) — every channel the PRD names now actually sends something, not just a saved preference. Delivery overall is still best-effort, not a durable retry-with-backoff dispatcher, and SMS specifically has never sent a real text in this build process (no Twilio credentials available here) — mirrors the already-working email code closely, but still worth testing with a real Twilio trial account before fully trusting it.
- Plan editing covers moving, dropping, adding, and editing a task's own title/priority/duration from inside the review card, and the new Tasks screen now covers full editing (description, due date, goal, tags) outside it too. Subtasks now have a real UI too (add, check off, remove, right on the Tasks screen), and the screen itself now pages 20 at a time with a real "Load more" instead of capping at 100 tasks total — but a subtask is still only ever one level deep (no sub-subtasks), and `SubtaskList` itself has no pagination of its own (a task realistically has a handful of subtasks, not hundreds).
- Insights now has task completion, focus-session consistency, and journal activity trends too — the three data sources this section used to say were missing — and all three now feed the correlation engine as well, alongside sleep/habit-completion. Cross-metric correlation checks same-day plus a one-, two-, and three-day lag, in both directions, at 26 base pairs (182 candidate checks total, capped at the 15 strongest actually shown) — a real Pearson coefficient, phrased as a tendency, only shown once there's a real sample size and a real relationship. The one deliberate exclusion left among these six metrics is sleep duration vs. sleep quality (same night's sleep entry, same reasoning mood-vs-energy has always been excluded for). Still open: it's not a fully rigorous statistical treatment — nearby days aren't truly independent samples, and this doesn't account for that, and there's no clear design yet for how to close it properly.
- Chat replies now stream in real time over a real GraphQL subscription (see the Real-time chat streaming section above) — the exact subscription-based design the API Design Document originally called for, not a shortcut. The AI can now also take seven real actions when asked — create, complete, or reschedule a task, log a mood or energy check-in, add a calendar event, or save a memory fact (see the Tool-calling actions in Chat and Expanded tool set for Chat sections above), the same actions already covers from its own suggestion cards or dedicated screens, now also reachable just by asking. Still open: goals, habits, focus sessions, journal entries, routines, and reflection still aren't reachable from inside a chat message.
- A routine's past consistency is judged against its *current* checklist length, since there's no per-day snapshot of what the checklist looked like historically — most visible right after editing a routine's steps.
- Burnout detection and voice input are intentionally deferred post-MVP (P1/P2) features, not oversights.
- No native iOS/Android app — the installed PWA is the realistic mobile story for now; a real native app would need Xcode/mobile toolchains and App Store accounts this kind of build process doesn't have.
- Offline support covers exactly three actions (add task, complete task, journal entry), not the whole app, and has no real conflict resolution for true multi-device concurrent editing — a queued offline change just replays in order on reconnect.
- There's now a real Playwright browser-test suite (`apps/e2e`, 16 spec files) covering Today, Tasks, Journal, PWA/offline, push notifications, an automated accessibility scan, Goals, Habits, Calendar, Focus sessions, check-ins, Reflection, Routines, Chat, AI Memory, Insights, the AI plan review flow, and now AI recommendations — real, interaction-level browser tests for basically every major screen now. Only Onboarding still has no spec of its own (reasonably covered indirectly — see the increment note above). None of these specs have actually been run in this sandbox (only hand-checked against the real source) — worth running for real before fully trusting them, and the AI recommendations spec specifically needs a real `ANTHROPIC_API_KEY` configured to run at all.
- AI recommendations now act on your behalf for all three categories, each with real, distinct follow-through, each customizable before committing, and the Workout booking now avoids real conflicts (see the AI recommendations acting on your behalf, Booking a workout as a real calendar block, Customize act-on defaults, and Workout-booking conflict avoidance sections above) — a Break suggestion starts a real break (15 min default, changeable), a Workout suggestion books a real calendar block at the next real open slot (30 min starting now by default, both changeable), and a Meal suggestion creates a real task (priority and due date both settable at the point of acting now). Still open: generation is request-driven only (you tap the button; nothing runs on a schedule).
- The accessibility pass fixed real, measured contrast failures, added headings/labels/landmarks/live-regions, and added an automated axe-core scan — but it's a thorough sweep of 13 pages' default state, not a guarantee of full WCAG AA compliance in every dialog or error state. The Screen-reader pass (see the Screen-reader pass section above) closes the specific class of gap axe structurally can't catch — missing ARIA state on toggles/tabs, incomplete live regions, no focus management — via a rigorous manual audit of the accessibility tree. Still not done: a real screen reader (VoiceOver/NVDA/JAWS) has never actually been run against this app — no GUI OS exists in this build sandbox — and that remains the single most valuable accessibility check still worth doing.
- Calendar events now have a real editor, and editing a Google- or Microsoft-synced event pushes that change to the real provider (deletes already did) — Apple sync is still pull-only, so an Apple-sourced event's edit stays local-only. Worth being honest if asked: the push-edit code has never actually been run against a real Google or Microsoft account in this build process — it was written by mirroring the already-working push-delete code's exact shape, which is a real risk reducer, but confirming it with a real connected account is still the single most valuable thing left to check on this whole project.
- Settings now covers timezone, chronotype, work hours, `displayName`, email (a real Clerk-hosted change flow, or read-only text under dev auth), a real Stripe-backed plan picker, real account deletion, and a real link to redo the onboarding quiz (which now pre-fills your existing answers) — everything onboarding's quiz used to write once and never let you touch again, plus the account-level basics. The plan picker now starts a real Stripe Checkout session and hands off to a real Stripe Billing Portal afterward (see the Real Stripe billing integration section above), with a graceful simulated fallback when no Stripe keys are configured — still open: no real Stripe account has ever been used in this build sandbox, so no real charge, checkout, or webhook from Stripe's own servers has ever actually happened here (the underlying signature-verification code has been verified against the real Stripe SDK's own cryptography, just not against Stripe's live systems). Account deletion has never been run against a real database in this sandbox, and the Clerk email-change modal has never been opened against a real Clerk account here either — both are real, correctly-written code following documented patterns, not confirmed-with-a-real-account verification.

---

## Behind the scenes: the Playwright test suite

Not something to click through live (there's no UI for it), but worth mentioning if the conversation turns to "how do you know this actually works" or "what does your testing look like": every increment since PWA + offline support had at least one piece of real browser behavior (a service worker, an install prompt, offline mode, a push permission grant) that no amount of backend-only testing could ever confirm. `apps/e2e` is a real Playwright suite that drives an actual Chromium browser against the real running app — adds a task, edits it, completes it, writes and edits a journal entry, confirms the service worker reaches "activated," takes the browser context fully offline and confirms the app shell still loads, confirms an offline-added task queues and later actually syncs to the server, and grants notification permission and completes a real push subscription round trip. If asked "did you actually run it" — be honest: no, not in this build environment specifically, since downloading the Chromium browser binary itself needs a fuller network connection than this sandbox allows (the exact same restriction that blocked an actual screenshot of Today, mentioned back at the very start of this project). It was verified as far as this sandbox allows — Playwright's own test-runner successfully parses the config and lists all 9 tests with no errors — and is meant to be run for real the moment there's a normal machine or CI environment available.

---

## Behind the scenes: the accessibility (WCAG AA) pass

Also worth walking through if asked "is this accessible" rather than just "does this work": before this pass, the app had zero accessibility work behind it — no real headings anywhere (every title was a styled paragraph), a few real color-contrast failures, several unlabeled form inputs, and no skip-link or nav landmark. All of that's fixed now, and fixed with real, computed numbers, not a guess — the border color, for instance, measured 1.26:1/1.31:1 against its background (WCAG needs 3:1 for a UI element's contrast) before being darkened to a real 3.32:1/3.69:1+; that's the one change worth pointing at live, since every card and input edge in the app is now visibly darker than before this pass. The new `apps/e2e/tests/accessibility.spec.ts` runs axe-core — the same engine behind Chrome DevTools' own Accessibility panel — against 13 of the app's pages, scoped to WCAG 2.0/2.1 A and AA rules, so a future regression (a dropped label, a contrast-failing color creeping back in) gets caught automatically. Same honest caveat as the Playwright suite above: this spec was written and syntax-checked but couldn't actually be executed in this sandbox, both because of the same Chromium-download block and because of a sandbox-only `node_modules` corruption hit while installing its one new dependency — real work to run for real on a normal machine, not a false "already verified" claim.

---

## Behind the scenes: extended Playwright coverage

The natural next question once someone sees the accessibility scan touching 13 pages is "does the rest of the suite cover that much too now?" — as of this pass, yes. 10 new spec files (Goals, Habits, Calendar, Focus sessions, check-ins + Reflection, Routines, Chat, AI Memory, Insights, and the full AI plan review flow — generate a real plan, review it, accept it) bring the suite from 5 core journeys to basically the whole app. The Chat and AI plan review specs are worth calling out specifically if asked "does this actually talk to the real AI in tests" — yes, on purpose, with generous timeouts rather than a mocked/canned reply, since confirming the real integration works is the entire point of an end-to-end suite. Same honest caveat as always: none of these 10 have been run for real in this sandbox — selectors were hand-checked against the actual page source, but that's a materially weaker signal than a green test run, and worth being upfront about if pressed on it.

---

## Suggested order recap (for a live 15–20 minute demo)

1. Onboarding (2 min)
2. Today tour (1 min)
3. Goals, incl. the "N of M tasks done" progress view (1-2 min)
4. Add tasks + AI duration estimate + goal link + Tasks screen + subtasks (2 min)
5. Calendar (1 min)
6. Generate & accept daily plan (2 min)
7. Weekly/monthly plan, incl. protecting a habit's time on any day across the window (1-2 min)
8. Habits, incl. linking a habit to a goal + custom recurrence (every N days/weeks/months, monthly, several days of the month, or a set of weekdays) + an optional end condition (count or date) + editing/reactivating (2-3 min)
9. Focus session, incl. a completed session pre-filling a task's actual-duration prompt + Pomodoro mode auto-chaining work/break blocks (2 min)
10. Check-ins (1 min)
11. Journal + Reflection (2 min)
12. Routines (1 min)
13. AI recommendations, incl. acting on one — a real break or a real added task (1-2 min)
14. Chat (2 min)
15. Memory (1 min)
16. Notifications (1 min)
17. Automatic re-planning, incl. all eight triggers + the "Auto-generated" pill (1-2 min)
18. Insights + Patterns worth noting, incl. multi-day/reverse-direction lag + task/focus/journal trends (2-3 min)
19. PWA + offline support (1-2 min)
20. Real notification delivery — push + email (1-2 min)
21. Accessibility (WCAG AA) pass — point out the darker borders, tab through a form with keyboard focus visible (1 min)
22. Settings — timezone, chronotype, work hours (1 min)
23. Broader account settings — display name, plan/email, account deletion (1 min)
24. Editable email + re-enter onboarding (1 min)
25. No visible auto-plan indicator (1 min) — covered live at step 17 above; skip this if already shown there
26. Goal progress view (1 min) — covered live at step 3 above; skip this if already shown there
27. Real billing/subscription management — the plan picker, with the honest "this is simulated" caveat (1 min)
28. Linking habits to goals (1 min) — covered live at step 8 above; skip this if already shown there
29. Full custom habit recurrence (1 min) — covered live at step 8 above; skip this if already shown there
30. Focus sessions feed task duration back (1 min) — covered live at step 9 above; skip this if already shown there
31. Weekly/monthly plans protecting habits across the window (1 min) — covered live at step 7 above; skip this if already shown there
32. Automatic Pomodoro work/break cycling (1 min) — covered live at step 9 above; skip this if already shown there
33. AI recommendations acting on your behalf (1 min) — covered live at step 13 above; skip this if already shown there
34. Habit-edit UI (1 min) — covered live at step 8 above; skip this if already shown there
35. Configurable Pomodoro durations (1 min) — covered live at step 9 above; skip this if already shown there
36. Booking a workout as a real calendar block (1 min) — covered live at step 13 above; skip this if already shown there
37. Configurable reminder windows/thresholds (1 min)
38. Customize act-on defaults at the point of acting (1 min) — covered live at step 13 above; skip this if already shown there
39. Workout-booking conflict avoidance (1 min) — covered live at step 13 above; skip this if already shown there
40. Reminder escalation / second nudge (1 min) — no dedicated UI, walk through it from the source
41. Real-time chat streaming (1 min) — covered live at step 14 above; skip this if already shown there
42. Tool-calling actions in Chat (1 min) — covered live at step 14 above; skip this if already shown there
43. Expanded tool set for Chat (1 min) — covered live at step 14 above; skip this if already shown there
44. Screen-reader pass (1 min) — quick dev-tools Accessibility panel check on Tasks/Today/Chat, or skip straight to the close
45. Real Stripe billing integration (1 min) — covered live at step 22 above (Settings' Plan section); skip this if already shown there
46. Fuller habit recurrence — every N months, and ending a habit after N times or on a date (1 min) — covered live at step 8 above; skip this if already shown there
47. BYSETPOS / multiple weekdays per month — several days of the month in one rule, and the last weekday of the month (1 min) — covered live at step 8 above; skip this if already shown there
48. Diagnostic quiz free-text answers — a real text box that actually reaches the AI's memory (1 min)
49. Free time picker for quiz's work/quiet hours — real time inputs instead of preset cards (1 min) — covered live at step 1/24 above; skip this if already shown there
50. Fix onboarding calendar-connect redirect — connecting a calendar from onboarding now returns to onboarding, not /calendar (1 min) — covered live at step 1 above; skip this if already shown there
51. Resumable onboarding wizard — reload /onboarding mid-wizard and it resumes instead of losing your place (1 min)
52. Free-text "biggest source of overload" — the quiz's last preset-only question is a real text field now (1 min)
53. Close with the honest "what's left" list (1 min)
