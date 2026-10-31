# daylog assistant — implementation plan

**Start here.** This is the main file for "the assistant": an AI assistant inside daylog, modelled
on Grok Bot and OpenAI's dots. It can read and change every part of the app (days, people, notes,
long-term tasks, routines, schedule, finance, activity), and it brings things up on its own at set
times and when something needs attention, so you don't have to keep asking it.

| File                                                         | What's in it                                                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **assistant.md** (this file)                                 | What we're building, the architecture and the step-by-step plan                                                                  |
| [docs/assistant/decisions.md](docs/assistant/decisions.md)   | The owner's choices (name, provider, check-in times, auto-apply rules…). **These win over this plan.**                           |
| [docs/assistant/progress.md](docs/assistant/progress.md)     | Which step is done, what was built, and exactly where to pick up next                                                            |
| [docs/assistant/evals.md](docs/assistant/evals.md)           | Messages it should handle and the tool calls expected (for Step 7 and manual checks)                                             |
| [docs/assistant/claude-mcp.md](docs/assistant/claude-mcp.md) | Using daylog from Claude Desktop / Claude Code (MCP server in the desktop app): how to connect, how it works                     |
| [docs/assistant/research.md](docs/assistant/research.md)     | How Grok Bot and dots work, facts about daylog's code, provider and ElevenLabs API notes, sources                                |
| [schedule-chat.md](schedule-chat.md)                         | Older plan for a Schedule-page chat. Its tool list (§5) and test messages (§9) are reused; its server route is replaced (see §3) |

**To continue in a new chat:** read this file, then `decisions.md`, then `progress.md`, and start
the first step `progress.md` marks as not done. Update `progress.md` at the end of every step.

---

## 1. The idea in one page

- **One assistant, many parts.** Each area of the app registers _tools_ (read and write). The
  assistant only acts through them, and every write goes through the shared ops layer (Step 0),
  so it can be undone exactly like a button press.
- **Proactive, not reactive.** Borrowed from dots and Grok Bot (details in
  [research.md](docs/assistant/research.md)):
  - **Scheduled check-ins**: 08:00 morning warm-up, 17:00 brief, 23:15 brief (editable in Settings).
  - **Detectors**: free, local checks over your data (deadline close and nothing planned, money
    written in a day but not recorded, a routine streak about to break…). The model only runs when
    one fires. This avoids dots' main problem, noisy and badly timed suggestions.
  - **Self-scheduled check-ins**: "remind me Thursday to check if the lab marks are in".
- **Safe by default.** Background runs are read-only and produce cards. **Small additions** (adding
  a line, task, note, subtask or routine value) are **applied straight away** and shown in a
  bubble with Undo. Changing, moving or cancelling existing things, and money, are **proposal
  cards**. Nothing is ever deleted by the assistant.
- **Your own key, your choice of model.** Claude or Gemini, switchable, key stored per device.
- **Everywhere.** Desktop app and web (including phone). Whichever device is open runs the
  check-ins; the Inbox syncs through Firestore.
- **Feels like JARVIS**: composed, anticipating, brief, a little dry wit. Named `Jarvis` by
  default; the name and how it addresses you are both settings (see decisions.md → Persona).

---

## 2. What it can do

### 2.1 Tools per area

| Area      | Read tools                                                        | Write tools                                            |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| Days      | `read_day`, `search_days` (text/mention/date range), `open_lines` | `append_line`★, `set_line_done`, `move_line`           |
| People    | `get_person` (bio, mentions, debt balance), `list_people`         | `append_person_note`, `set_person_name`                |
| Notes     | `search_notes`, `read_note`                                       | `create_note`★, `append_to_note`★                      |
| Long-term | `list_longterm`                                                   | `add_longterm`, `add_subtask`★, `complete_subtask`     |
| Routines  | `routine_stats` (today, streaks, month)                           | `log_routine_value`★                                   |
| Schedule  | `schedule_snapshot` (as in schedule-chat.md §7)                   | `add_task`★ and the other tools in schedule-chat.md §5 |
| Finance   | `finance_summary` (month, categories, pace), `find_transactions`  | `add_transaction`, `update_transaction`, `settle_up`   |
| Activity  | `activity_day` (summary, insights, goals), `focus_window`         | `set_day_goal`                                         |
| UI        | `current_view` (page, date, filters)                              | `navigate`, `show_bubble`                              |
| Assistant | `recall`                                                          | `remember`★, `forget`, `schedule_checkin`              |

★ = small addition: auto-applied with an Undo bubble (see decisions.md). Everything else is a
proposal card unless you've switched that kind to "always allow". No delete tools.

### 2.2 Proactive features

1. **08:00 morning warm-up** — what's up for the day: classes and rooms, tasks with time blocks,
   near deadlines, anything carried over from yesterday (move it here?), best focus window.
2. **17:00 brief** — what's still open today, tonight's and tomorrow morning's schedule, anything
   due tomorrow, spending pace if it's off.
3. **23:15 brief** — what got done, what's left (move to tomorrow / Later / drop?), routines and
   money mentioned but not logged, streaks at risk, first thing tomorrow.
4. **Capture → structure** — a few seconds after you stop typing (day page or quick bar), lines that
   look like money, dates, cancellations or deadlines get a chip: `exam on nov 12` → "add as
   deadline ✓"; `gave @rahim 500` → a lend to approve. The line itself stays as written.
5. **Deadline planner** — a deadline ≤ 5 days away with no tasks for it → 2–4 proposed tasks in
   free blocks around the timetable and your best focus hours.
6. **Pre-event prep** — 30 min before a class/meeting/exam: related open tasks and notes; for
   meetings with `@person`, a person brief (last mentions, money between you, notes).
7. **Weekly review** (end of the Sun–Thu week) — saved as a Note, with a proposed plan for next week.
8. **Money watch** — spending pace well ahead of last month, unusual transactions, debts open > 30
   days.
9. **Focus coach** (desktop, opt-in) — a distraction limit about to run out, or a best-focus hour
   with nothing planned. At most one nudge an hour.
10. **Ask your log** — "when did I last talk to @rahim about the thesis?", "transport spend in Sept?"
11. **Self-scheduled check-ins** via `schedule_checkin`.

### 2.3 Where you see it

- **Assistant drawer** on every page (`Ctrl+J`), aware of the page you're on.
- **Bubbles** — toasts with the assistant's name, saying what it just did, with **Undo**. (Built on
  `toast.svelte.ts`, which already supports Undo.)
- **Inbox** — proposal and brief cards (Apply / Edit / Dismiss / "Don't suggest this again"), at
  the top of the day page's Plan panel and in the drawer. Synced across devices.
- **Command palette / quick bar** — start with `?` to ask the assistant.
- **Desktop notifications** for time-critical cards only.

---

## 3. Provider: switchable, bring-your-own key

Options compared (fixed Claude on the Worker, fixed one provider on the device, switchable, routing
across providers): **switchable with your key on the device** wins.

- **Why not the server route from schedule-chat.md:** the desktop app is a static build with no
  Worker, and every call would be paid from a key on the server.
- **Why switching is cheap:** both Claude and Gemini support the one thing needed, chat with
  function calling. A narrow adapter converts messages, tool definitions and tool calls/results:
  about 150 lines per provider with plain `fetch`, no SDKs.
- **One active provider, two model slots:** a _chat model_ (strong) and a _background model_
  (cheap; Gemini Flash has a free quota). Model lists come from each provider's models endpoint,
  so nothing is hard-coded.
- **Threads belong to one provider**, because both require their reasoning data (Claude thinking
  blocks, Gemini thought signatures) to be sent back unchanged. Switching starts a new thread;
  memory and the Inbox carry over.
- **Schemas** stay within what both accept (no `oneOf` / `$ref`); every id and argument is
  validated, since Gemini doesn't guarantee strict schemas.
- **Where the call happens:** web → browser `fetch` straight to the provider (Claude needs the
  `anthropic-dangerous-direct-browser-access` header); desktop → a Tauri command in Rust (`ureq`),
  with the key in the OS keychain (`keyring` crate).
- **Key storage:** per device, never in Firestore. A daily token budget per device stops runaway
  cost.
- Later, an OpenAI-compatible adapter would add OpenRouter / OpenAI / local Ollama cheaply.

API details: [research.md §3](docs/assistant/research.md#3-llm-providers).

---

## 4. Architecture

```
          ┌───────────────────── triggers ─────────────────────┐
 check-in times (08:00 / 17:00 / 23:15) · desktop tick (Rust) · app open ·
 tab visible · after typing · schedule_checkin due
          │
          ▼
  detectors (pure, local, free) ── nothing to say ──▶ stop
          │ signals[]
          ▼
  gate: lease · quiet hours · daily caps · dedupe · feedback
          │
          ▼
  background run (background model, read tools only)
          │ cards[] (brief / proposal{changes[]} / question)
          ▼
  Firestore users/{uid}/assistant/inbox ──sync──▶ every device
          │
          ▼
  Inbox → Apply → ops layer (run → commit → Undo toast)

  chat (drawer / palette "?") → run (chat model, read + write tools)
     small additions → applied now + bubble with Undo
     everything else → proposal card in the chat
```

- **Lease** (`assistant/lease { deviceId, until }`): only one device runs check-ins at a time. The
  desktop app takes it when running; otherwise any open web tab (phone included) does. A missed
  check-in runs when the next device opens, if it's still the same day.
- **Desktop tick from Rust**, because hidden webviews throttle timers (same reason reminders live in
  `reminders.rs`).
- **No server.** Firestore rules already cover `users/{uid}/**`.

### Data (Firestore, under `users/{uid}/`)

| Doc / collection          | Contents                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistant/config`        | name, how it addresses you, check-ins (time + on/off + kind), quiet hours, caps, permission per change kind, data areas sent to the provider |
| `assistantMemory/{id}`    | `{ text, kind: preference / fact, updatedAt }`, editable in Settings                                                                         |
| `assistantInbox/{id}`     | `{ kind, source, title, body, tool, details[], changes (JSON), signalKey, priority, status, expiresAt, createdAt }`                          |
| `assistantThreads/{id}`   | `{ provider, model, history (JSON, dropped past 600 KB), entries (JSON), updatedAt }`; newest 20 kept                                        |
| `assistantCheckins/{id}`  | `{date}_{checkinId}`: `{ status, at, attempts, device }` — each check-in's run that day                                                      |
| `assistantFollowups/{id}` | `{ at, why, status, claimedAt }` from `schedule_checkin`                                                                                     |
| `assistantSignals/{key}`  | `{ key, type, at }` — detector signals already raised                                                                                        |
| `assistant/lease`         | `{ deviceId, until }`                                                                                                                        |
| `assistant/feedback`      | applied / dismissed / muted counts per signal type                                                                                           |
| _(per device)_            | API key, provider, model slots, today's token usage                                                                                          |

---

## 5. Steps

Each step ends with `npm run check`, `npm run lint`, unit tests, and the Svelte autofixer on
touched components (when the Svelte MCP server is reachable). Record the result in `progress.md`.

### Step 0 — Ops layer ✅ (see progress.md)

`src/lib/ops/`: every change is a `Change { kind, id, before, after }`; pure planners per area
return them; `run()` applies them to page state, saves through `db.ts` and shows an Undo toast;
`invert()` is the undo. The Schedule page runs on it. Other pages can move over when they're
touched (listed in progress.md).

### Step 1 — Providers and settings ✅ (see progress.md)

`src/lib/ai/`: one `Adapter` interface (`send`, `listModels`, `pickDefaults`) with a Claude adapter
(official SDK, loaded only when used) and a Gemini adapter (REST). Keys per device: browser
storage on the web, the OS credential store on desktop, where Rust (`src-tauri/src/ai.rs`) adds
the key to each request. Synced settings in `assistant/config` (name `Jarvis`, check-ins, quiet
hours, areas); per-device provider, models and daily token limits. Settings → **Assistant**.

### Step 2 — Tool registry and chat ✅ (see progress.md)

`src/lib/ai/tools/`: a `Tool` is a schema plus `run`, with `area` (filtered by Settings) and
`kind` (`read` / `ui` / `write`). Read tools for every area plus `open_page`; inputs validated
before running. `agent.ts` loops over the adapter (max 8 tool rounds, budget checked, usage
counted); `prompt.ts` holds the fixed JARVIS prompt and the per-message `<context>`. Chat panel
(`Ctrl+J`, sidebar/header button, `?` in the palette and the desktop quick bar).

### Step 3 — Write tools, bubbles, approvals ✅ (see progress.md)

26 write tools plan `Change[]` with the Step 0 ops; `ctx.propose` applies small additions at once
(bubble with Undo) and turns the rest into cards (Apply / Dismiss / "Always do this"). Cards are
checked against the stored data before applying (`ops/fresh.ts`). What you did with a card is
told to the assistant with your next message. Open day, note and person pages receive changes
through themselves (`capture.ts`, `live.ts`). Settings list which kinds happen without asking.
Eval cases in [docs/assistant/evals.md](docs/assistant/evals.md).

### Step 4 — Memory and Inbox ✅ (see progress.md)

`remember`★ / `forget` / `recall`, with memory sent at the start of each conversation and a list
in Settings to add, edit and forget. Cards are stored in `assistantInbox` (live on every device),
shown in the chat, at the top of the panel ("Waiting for you") and at the top of today's Plan
panel; they expire after a week. Conversations are saved in `assistantThreads` and picked up after
a reload.

### Step 5 — Proactive engine ✅ (see progress.md)

Split into parts 5.1–5.7 (background runs → scheduler → lease → web triggers → desktop wake-ups →
detectors → notifications and feedback); see progress.md.

- `src/lib/ai/detectors/*.ts` — pure `(data, now, config) → Signal[]`, stable `signalKey` for
  dedupe, fully unit-tested.
- `src/lib/ai/scheduler.ts` — check-in times, lease, quiet hours, caps, feedback; one background
  run per batch of signals, read tools only, answers with cards.
- `src-tauri/src/assistant.rs` — tick + wake at the next check-in.
- Web: run on open, on tab visible (≤ every 15 min), on lease takeover.
- Desktop notifications for high-priority cards.

### Step 6 — Feature packs ✅ (see progress.md)

In order: 08:00 warm-up → 17:00 / 23:15 briefs → capture → structure → deadline planner →
weekly review → pre-event prep and person briefs → money watch → focus coach.

### Step 7 — Evaluation and tuning

- `src/lib/ai/evals/` (~30 cases) run by hand on both providers (`npm run eval:ai`, never in CI).
- Usage log per device, shown in Settings.
- After two weeks, retune or drop detectors with low apply rates.

### Voice mode (ElevenLabs) ✅ (see progress.md)

On only while an ElevenLabs key is saved on the device; off otherwise. Tap the mic in the panel,
speak, pause (or tap again); the transcript goes into the normal agent loop, so tools, memory and
approvals work the same, and the reply is read aloud in a calm British voice. "Read aloud" on any
reply or brief. Batch speech-to-text (Scribe) after you finish speaking rather than a realtime
WebSocket — simpler, no token minting, and fast enough for short questions. Web: key in local
storage, straight to ElevenLabs. Desktop: key in the OS keychain, audio through Rust
(`voice.rs`).

Notes: [research.md §4](docs/assistant/research.md#4-elevenlabs-future-voice-mode).

### Claude (MCP server) ✅ (see progress.md)

For a Claude subscription without an API key: the desktop app is an MCP server, so Claude
Desktop and Claude Code use the same tools under the same rules (small additions with Undo, the
rest as Inbox cards). Claude starts `daylog --mcp`, which relays to the running, signed-in app.
Off until switched on in Settings → Use daylog from Claude. Setup and design:
[claude-mcp.md](docs/assistant/claude-mcp.md).

---

## 6. Risks

- **Noise** → detectors gate every run, caps, quiet hours, mute, feedback.
- **Wrong edits** → small additions only auto-apply (with Undo); everything else needs Apply; ids
  validated; no deletes.
- **Cost** → cheap background model, local detectors, daily cap per device.
- **Two devices running check-ins** → Firestore lease.
- **Key leaks** → per device, keychain on desktop, never synced.
- **Provider differences** → narrow adapter, shared schema subset, evals on both.
