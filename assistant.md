# daylog assistant — ideas and implementation plan

A plan for an AI assistant that can read and change every part of daylog and that brings things up
on its own, so you don't have to keep telling it what to do. Nothing here is built yet. This plan
replaces the server-side route in [`schedule-chat.md`](./schedule-chat.md): that route becomes one
tool pack inside the assistant (see "Where the model is called" for why).

Research done on 2026-10-30. Model ids and API details change often; check them again before building.

---

## 1. What Grok Bot and dots do, and what to borrow

Both are "always-on" personal agents released in Sept–Oct 2026. Neither publishes its internals, so
this is pieced together from their help pages and press coverage.

**Grok Bot** (SpaceXAI + Cursor) — named, persistent "teammates":

- **Routines**: scheduled runs that keep going in the cloud while your laptop is closed. A bot can
  set up a routine itself when you ask it in chat.
- **Memory**: stable preferences, important facts and summaries. The docs say memory is not a
  source of truth: before anything consequential, the bot rereads the current data.
- **Approvals**: consequential actions (sending, buying, deleting) show as cards with _Allow once_,
  _Always allow_ and _Deny_. A request raised by a routine expires (reportedly after about 10 min)
  if nobody answers.

**dots** (OpenAI) — an assistant that keeps working between conversations:

- **Proactive research**: on a cadence, the dot reviews what it knows about you, the conversation
  history and the apps it can reach, then works out how it could help. This step is **read-only**:
  it never sends, edits or clicks. Its ideas appear as proposals in an activity feed.
- **Scheduled check-ins and reminders** that you set up by asking. A dot can also decide when to
  wake up next.
- **Main criticism**: timing and usefulness. Early users found the proactive suggestions noisy or
  badly timed.

**What daylog borrows:**

| Idea                                 | In daylog                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background work is read-only         | Proactive runs only **propose** changes. Every write goes through a card you approve, or one you've set to "always allow" with undo.                              |
| Approval cards with "always allow"   | A permission level per action type, set from the card itself                                                                                                      |
| Memory isn't the source of truth     | Memory stores preferences and facts. Every run reads fresh data from Firestore.                                                                                   |
| Routines and self-scheduled wake-ups | Built-in check-ins (morning, evening, weekly) plus `schedule_checkin` for custom ones                                                                             |
| Activity feed                        | An **Inbox** of proposals and briefs, synced across devices                                                                                                       |
| Avoid dots' noise problem            | Free local signal detectors decide _whether_ there's anything to say. The LLM only runs when one fires. Daily caps, quiet hours, dedupe, and 👍/dismiss feedback. |

daylog has an advantage over both: its data is already structured (schedule, tasks, deadlines,
finance, routines, activity), so the assistant doesn't have to scrape apps or drive a browser.

---

## 2. What can be built

### 2.1 The assistant can talk to every part of the app

One **tool registry** where each area of the app registers read tools and write tools. The
assistant only sees tools, never Firestore directly.

| Area      | Read tools                                                         | Write tools (propose → apply)                                    |
| --------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Days      | `read_day`, `search_days` (text/mention/date range), `open_lines`  | `append_line(date, text)`, `set_line_done`, `move_line(to date)` |
| People    | `get_person` (bio, mentions, debt balance), `list_people`          | `append_person_note`, `set_person_name`                          |
| Notes     | `search_notes`, `read_note`                                        | `create_note`, `append_to_note`                                  |
| Long-term | `list_longterm`                                                    | `add_longterm`, `add_subtask`, `complete_subtask`                |
| Routines  | `routine_stats` (today, streaks, month)                            | `log_routine_value`                                              |
| Schedule  | `schedule_snapshot` (the snapshot from schedule-chat.md)           | the 13 tools from schedule-chat.md §5                            |
| Finance   | `finance_summary` (month, categories, pace), `find_transactions`   | `add_transaction`, `update_transaction`, `settle_up(person)`     |
| Activity  | `activity_day` (summary, insights, goals progress), `focus_window` | `set_day_goal`                                                   |
| UI        | `current_view` (page, date or filter you're looking at)            | `navigate(route)`, `show_toast`                                  |
| Assistant | `recall` (memory)                                                  | `remember`, `forget`, `schedule_checkin(when, why)`              |

There is no delete tool apart from undoing the assistant's own changes. Deleting stays manual.

### 2.2 Proactive features (the point of the assistant)

Each feature is a **signal detector**: a pure, unit-tested function over local data that decides
whether there's something worth saying. The LLM only runs when a detector fires.

1. **Morning brief** (first time the app opens after 05:00, or at a time you pick): today's
   classes and rooms, tasks with time blocks, deadlines within 7 days, open lines carried over from
   yesterday, a routine streak at risk, and the focus window your Activity data says works best.
   It ends with 1–3 suggested changes, such as "move yesterday's 3 unfinished lines here?".
2. **Evening wrap-up** (configurable, default 21:30): unfinished lines and tasks → "move to
   tomorrow / Later / drop?". Routines not logged yet → "log today's pages?". Money mentioned in
   day text but never recorded (`lunch 250`, `gave @rahim 500`) → a pre-filled transaction to
   approve.
3. **Capture → structure** (runs a few seconds after you stop typing on a day page or in the quick
   bar). A cheap regex pre-filter decides whether a line looks like money, a date, a cancellation
   or a deadline, and only those lines go to the LLM, which proposes the matching record:
   `exam on nov 12` → deadline; `@rahim paid me back 500` → borrow/settle; `no class tomorrow` →
   cancel that occurrence. The line stays as you wrote it, and a small chip next to it offers
   "→ add as deadline ✓".
4. **Deadline planner**: a deadline ≤ 5 days away with no tasks pointing at it → proposes 2–4
   tasks placed in free blocks around the timetable and your best focus hours.
5. **Pre-event prep** (30 min before a class, meeting or exam): open tasks or notes related to it,
   and for a meeting that mentions `@person`, a short **person brief** (last mentions, what they
   owe, notes).
6. **Weekly review** (end of the Sun–Thu week): what got done, what slipped, money in and out,
   routine streaks, focus hours. Saved as a Note, with a proposed plan for next week.
7. **Money watch**: spending pace X% ahead of last month, an unusual transaction for its
   category, debts open longer than 30 days → "remind @rahim?" (this only drafts a line; the
   assistant never sends messages).
8. **Focus coach** (desktop, opt-in): a distraction limit is about to run out, or it's your best
   focus hour and nothing is planned → one gentle nudge, never more than one an hour.
9. **Ask your log**: "when did I last discuss the thesis with @rahim?", "how much did I spend on
   transport in Sept?". These are plain chat questions, answered with the read tools.
10. **Self-scheduled check-ins**: "remind me Thursday to see if the lab marks are in" →
    `schedule_checkin`, which shows up in the Inbox on that day (and as a desktop notification).

### 2.3 Where you see it

- **Assistant drawer** on every page (reusing `Drawer.svelte`, shortcut `Ctrl+J`). It knows the
  page you're on and what's selected.
- **Inbox**: proposal and brief cards (Apply / Edit / Dismiss / "Don't suggest this again"). It's
  a section at the top of the day page's Plan panel and a full list in the drawer. It syncs
  through Firestore, so a proposal made on the desktop shows up on your phone.
- **Command palette / quick bar**: start with `?` to ask the assistant instead of capturing a
  line. On desktop, `Ctrl+Alt+Space` then `?` works from any app.
- **Desktop notifications** (existing `notify.rs`), only for cards marked high priority (time
  bound: about-to-start events, deadlines today). Clicking one opens the card.

---

## 3. Provider decision: switchable, bring-your-own key

### Options

| Option                                                  | Pros                                                                                                                       | Cons                                                                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fixed: Claude, key on the Worker** (schedule-chat.md) | Simplest. Can use every Claude-specific feature. Key never on a device.                                                    | **The desktop app has no Worker** (it's a static build served from localhost), so it would have to call the deployed site. You pay for every call. No Gemini. |
| **Fixed: one provider, your key on the device**         | Simple, works in the desktop app and on the web.                                                                           | Locked to one vendor's prices and outages. Gemini's free tier and Claude's quality can't be combined.                                                         |
| **Switchable, your key on the device** ✅               | Use Claude or Gemini, change any time, pick a cheap model for background runs and a strong one for chat. Works everywhere. | A small adapter layer, and prompts tested on two providers. Can only use features both providers support.                                                     |
| Multi-provider routing (both at once)                   | —                                                                                                                          | Complex, and it doesn't solve anything you have.                                                                                                              |

### Recommendation: switchable, with a narrow adapter

- Both providers do the one thing the assistant needs: **chat with function calling and JSON-schema
  tools**. The adapter only has to convert three things: messages, tool definitions and tool
  calls/results. That's about 150 lines per provider using plain `fetch`, with no SDKs (they add
  bundle size, and the Anthropic SDK has Node quirks in a static build).
- **One active provider, two model slots**:
  - _Chat model_ — strong, used when you're talking to it (e.g. `claude-sonnet-5-5`, or Gemini's
    Pro tier).
  - _Background model_ — cheap, used by proactive runs (e.g. `claude-haiku-5-5`, or Gemini's Flash
    tier, which also has a free quota).
  - Model ids aren't hard-coded. Settings fetches each provider's **models list** endpoint with
    your key and suggests defaults. That way new models show up without a release.
- **Threads are tied to one provider.** Both providers require their own reasoning data to be sent
  back unchanged in multi-turn tool use (Claude's thinking blocks, Gemini's thought signatures), so
  each thread stores the provider's raw transcript. Switching provider starts a new thread. Memory
  and the Inbox don't depend on the provider and carry over.
- **Schemas stay within what both support**: object/string/number/boolean/array/enum,
  `nullable` for optional values, no `oneOf`/`$ref`. Ids the model returns are always checked
  against the data, because Gemini doesn't guarantee strict schemas the way Claude's
  `strict: true` does.
- **A third adapter later**: an "OpenAI-compatible" adapter would add OpenRouter, OpenAI and local
  Ollama at almost no cost. Not in scope now.

### Where the model is called and where the key lives

- **Web**: the browser calls the provider directly with your key. Anthropic allows this with the
  `anthropic-dangerous-direct-browser-access: true` header. Gemini's API accepts browser calls.
  The key is kept in `localStorage` **on that device only**, with a clear note in Settings. It's
  your own key, in your own browser, sent only to the provider.
- **Desktop**: the webview passes the request to a Tauri command that makes the HTTP call in Rust
  (`ureq` is already a dependency). The key stays in the OS credential store (`keyring` crate),
  where web content can't read it, and there are no CORS issues.
- **Never in Firestore by default.** Your days sync to every device, but a key should be entered
  once per device. Phones can still use the Inbox produced by the desktop without a key.
- **Spending guard**: a daily token budget per model slot (stored per device, shown in Settings).
  When it runs out, proactive runs stop for the day and chat asks before going on.

---

## 4. Architecture

```
               ┌──────────── triggers ────────────┐
 desktop tick (Rust, 5 min) · app open · visibility · after typing · schedule_checkin due
               │
               ▼
     detectors (pure, local, free)  ──none fired──▶ stop
               │ signals[]
               ▼
     gate: lease · quiet hours · daily caps · dedupe · feedback weights
               │
               ▼
     agent run (background model, read tools only)
               │ cards[]  (brief / proposal{ops[]} / question)
               ▼
  Firestore users/{uid}/assistant/inbox  ──sync──▶ every device
               │
               ▼
     Inbox UI → Apply → ops layer → db.ts saves → one Undo toast

  chat (drawer / palette '?') → agent run (chat model, read + write tools)
     writes: "always allow" kinds apply now with undo; everything else becomes a card in the chat
```

- **Who runs background jobs**: whichever device holds the **lease**
  (`assistant/lease { deviceId, until }`, renewed each tick). Normally that's the desktop app, since
  it's always running. When no desktop app is running, a web tab takes over while it's open. This
  stops two devices from writing the same morning brief twice.
- **Why the tick comes from Rust**: hidden webviews throttle timers (that's also why reminders live
  in `reminders.rs`). The shell sends an `assistant-tick` event, and the webview runs the
  detectors.
- **No server**: still client-only, matching how the rest of the app works. Firestore rules already
  cover `users/{uid}/**`, so they don't change.

### Data (all under `users/{uid}/assistant/…`)

| Doc / collection | Contents                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`         | name/persona, enabled detectors and their times, quiet hours, max cards per day, permission per action type, which data areas may be sent to the provider |
| `memory/{id}`    | `{ text, kind: 'preference' \| 'fact' \| 'summary', source, updatedAt }`, which you can see and edit in Settings                                          |
| `inbox/{id}`     | `{ kind, title, body, ops[], signalKey, priority, status: 'new' \| 'applied' \| 'dismissed' \| 'expired', expiresAt, createdAt }`                         |
| `threads/{id}`   | provider, model, raw transcript (capped; once too long, start a new thread with a summary)                                                                |
| `checkins/{id}`  | `{ at, why, done }`, from `schedule_checkin`                                                                                                              |
| `lease`          | `{ deviceId, until }`                                                                                                                                     |
| `feedback`       | counts per `signalKey` type (applied / dismissed / muted) used to tune what it brings up                                                                  |
| _(per device)_   | API key, provider, model slots, today's token usage                                                                                                       |

### Privacy controls

Settings → Assistant → **What it can see**: Days, People, Notes, Schedule, Finance, Activity
(window titles off by default). Turning an area off removes that area's tools and its detectors.
The provider only sees what the tools return.

---

## 5. Implementation plan

Each phase is usable on its own and ends with `svelte-check`, lint, unit tests and the Svelte
autofixer on touched components.

### Phase 0 — Ops layer (groundwork, useful without AI)

- `src/lib/ops/` — `{schedule,tasks,deadlines,days,finance,people,notes,routines,longterm}.ts`.
  Each exports pure `apply(state, op) → { writes, undo }` with the same op shape the tools use.
- Move the mutation code out of `src/routes/schedule/+page.svelte` (as planned in
  schedule-chat.md §8) and the finance/day pages onto these ops, so buttons and the assistant share
  one code path.
- `applyBatch(ops)` → saves through existing `db.ts` functions and shows one Undo toast.
- Tests next to the existing `*.spec.ts`.

### Phase 1 — Providers and settings

- `src/lib/ai/types.ts` — the shared format: `Message`, `ToolDef`, `ToolCall`, `ToolResult`,
  `RunResult { text, calls, usage, raw }`.
- `src/lib/ai/providers/anthropic.ts`, `gemini.ts` — `send(req): Promise<RunResult>`,
  `listModels(key)`, error mapping (rate limit, bad key, refusal / safety block).
- `src/lib/ai/transport.ts` — direct `fetch` on the web, Tauri command on desktop.
- `src-tauri/src/ai.rs` — `ai_request(provider, body)` and `ai_key_{get,set,clear}` through
  `keyring`. Register in `commands.rs` and add to the `DesktopBridge` in `desktop.ts` /
  `desktop-tauri.ts`.
- `src/lib/ai/budget.ts` — per-device token counter and cap.
- Settings → **Assistant** section: provider, key (Test button), chat/background model (from
  list), budget.
- Tests: adapter round-trips with recorded fixture responses for both providers (no network in CI).

### Phase 2 — Tool registry and chat (it can answer questions)

- `src/lib/ai/tools/registry.ts` — `defineTool({ name, area, kind: 'read' | 'write', schema,
describe(input) → plain text for cards, run(ctx, input) })`. Converted per provider.
- Read tools for every area (§2.1). They return trimmed JSON (ids, short fields) to save tokens.
- `src/lib/ai/agent.ts` — the loop: send → run read tools → send results → … (max ~8 steps) →
  final text plus any write calls.
- `src/lib/ai/prompt.ts` — fixed system prompt (keeps provider prompt caching working). Today's
  date, current view, memory and persona go in the first user message.
- `AssistantDrawer.svelte` + `Ctrl+J` in the shortcuts list; `?` prefix in `CommandPalette.svelte`.

### Phase 3 — Write tools, approvals, undo

- Write tools turn into ops (Phase 0). Every id is checked against fresh data, and unknown ids
  become "couldn't find …".
- `ProposalCard.svelte` — plain-language list of ops with a checkbox each, plus Apply / Edit /
  Dismiss, with _Always allow this kind_ in a menu.
- Permission levels per op kind in `assistant/config`: `ask` (default) · `auto+undo` (defaults to
  `append_line`, `add_task`, `create_note`, `log_routine_value`) · `off`.
- The schedule-chat test set (schedule-chat.md §9) becomes the first eval set.

### Phase 4 — Memory and Inbox

- `remember` / `recall` / `forget` tools. The system prompt tells the model to save lasting
  preferences ("courses are called by their short names", "I don't log cash under 20").
- Memory list in Settings, with edit and delete.
- Inbox collection, `InboxList.svelte`, Inbox section at the top of `PlanPanel.svelte`, expiry
  sweep.

### Phase 5 — Proactive engine

- `src/lib/ai/detectors/*.ts` — pure functions `(data, now, config) → Signal[]`, each with a
  stable `signalKey` (e.g. `wrap:2026-10-30`, `deadline-plan:<id>`) for dedupe. Fully
  unit-tested, with no LLM involved.
- `src/lib/ai/scheduler.ts` — trigger sources, lease, quiet hours, daily caps, feedback weighting,
  then one background run per batch of signals. That run sees **read tools only** and must reply
  with cards (dots' read-only rule).
- `src-tauri/src/assistant.rs` — 5-minute tick event, plus a wake-up at the next `checkin.at`.
- Web: run on app open, on tab becoming visible (at most every 15 min), and on lease takeover.
- Desktop notification for `priority: high` cards.

### Phase 6 — Feature packs (one detector + prompt + card layout each)

In order of value: evening wrap-up → morning brief → capture → structure → deadline planner →
weekly review → pre-event prep and person briefs → money watch → focus coach.

### Phase 7 — Evaluation and tuning

- `src/lib/ai/evals/` — about 30 cases (messages + data fixture → expected ops), run by hand
  against both providers (`npm run eval:ai`, never in CI because it costs money).
- Log usage per run in a device-local ring buffer, shown in Settings ("this week: 212k tokens,
  ≈ $0.40").
- After two weeks, look at applied/dismissed rates per detector and drop or retune the noisy ones.

---

## 6. Risks

- **Noise** (dots' main problem) → detectors gate every run, at most 5 unread cards a day,
  quiet hours, a mute button on every card, a feedback loop.
- **Wrong edits** → nothing is written without a card or undo. Ids are checked. No deletes.
- **Cost runaway** → background model + local detectors + daily token cap per device.
- **Two devices both running** → Firestore lease.
- **Key leakage** → per device, OS keychain on desktop, never synced, never sent anywhere except
  the provider.
- **Provider differences** → the narrow adapter, the shared schema subset, the eval set run on both.

## 7. Open questions for you

1. Should it have a name or persona (Grok Bot style), or just be "Assistant"?
2. Which areas may it send to the provider by default? Finance and Activity are the sensitive ones.
3. Default permission for small additive writes (adding a line or task): ask every time, or apply
   at once with undo?
4. Times for the morning brief and evening wrap-up, and quiet hours.
5. Should the desktop app be the only device that runs background jobs, or may the web/phone take
   over when the desktop is off?
