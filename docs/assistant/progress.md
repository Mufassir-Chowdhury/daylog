# Assistant — progress log

Where the build stands, so any chat can pick up from here. Read [the plan](../../assistant.md)
and [decisions](./decisions.md) first. Research notes: [research.md](./research.md).

**Update this file at the end of every step**: tick the step, list what was built, note anything
that differs from the plan, and say what comes next.

| Step | What                            | Status                   |
| ---- | ------------------------------- | ------------------------ |
| 0    | Ops layer                       | ✅ done 2026-10-30       |
| 1    | Providers and settings          | ✅ done 2026-10-30       |
| 2    | Tool registry and chat          | ✅ done 2026-10-30       |
| 3    | Write tools, bubbles, approvals | ✅ done 2026-10-30       |
| 4    | Memory and Inbox                | ✅ done 2026-10-30       |
| 5    | Proactive engine (5.1–5.7)      | 5.1 ✅ · ⏭ **next: 5.2** |
| 6    | Feature packs                   | not started              |
| 7    | Evaluation and tuning           | not started              |
| —    | Voice mode (ElevenLabs)         | future, not scheduled    |

---

## Step 0 — Ops layer (done 2026-10-30)

### What was built

- **`src/lib/ops/change.ts`** (pure)
  - `Change = { kind, id, before, after }`. `before: null` = create, `after: null` = remove.
  - Kinds: `slot`, `event`, `task`, `deadline`, `weekNote`, `transaction`, `note`, `longterm`,
    `person`, `routineValue` (`{ date, routineId, value }`, id `date:routineId`), `dayLine`
    (`{ date, line }`, a line appended to a day; removing it is the undo).
  - `keyOf(kind, doc)`, `change(kind, before, after)`, `put(kind, list, after)` (create or
    update against a list), `invert(changes)` (the undo), `patch(list, changes, kind)` (apply to
    page state).
- **`src/lib/ops/schedule.ts`** (pure): `findOccurrence`, `addEvent`, `setEventStatus`,
  `updateEvent`, `moveEventTo`, `removeEvent`, `cancelWeekClasses`, `setWeekNote`, `addTask`,
  `updateTask`, `setTaskStatus`, `moveTaskTo`, `removeTask`, `addDeadline`, `updateDeadline`,
  `removeDeadline`, `addSlot`, `updateSlot`, `removeSlot`. Virtual timetable occurrences become
  creates, so undo removes the override again.
- **`src/lib/ops/records.ts`** (pure): `appendLine`, `addTransaction`, `updateTransaction`,
  `createNote`, `appendToNote`, `addLongTerm`, `addSubtask`, `setSubtaskDone`, `setLongTermDone`,
  `logRoutineValue`, `appendPersonNote`, `setPersonName`.
- **`src/lib/ops/commit.ts`**
  - `commit(uid, changes)` writes through `db.ts`. Day lines for the same day are applied
    together, in order (one load, one save, or through the open day page).
  - `run(uid, changes, { local, message })`: updates the caller's state through `local`, saves
    in the background (`saveFailed` toast on error), and with a `message` shows a toast with
    **Undo** that applies `invert(changes)` both locally and in Firestore.
  - The assistant's auto-applied "small additions" and its bubbles (Step 3) are meant to be
    `run(...)` plus a bubble.
- **`src/lib/capture.ts`**: `registerDayAppender` became `registerDayEditor(date, { append, remove })`.
  New `editDayLines(uid, date, edits)`. The open day page now also supports removing a line.
- **`src/lib/parse.ts`**: `removeLine(text, line)` (removes the last exact match; undoes
  `joinLine`).
- **Schedule page** (`src/routes/schedule/+page.svelte`): every button and form now goes
  through `ops.*` + `run`. The event editor keeps the whole `Occurrence` (`editing.occ`) so
  virtual/stored is known. The old per-type `put…`/`drop…` helpers are gone.
  - No visible behaviour change: the same toasts and Undo buttons as before.
- **Tests**: `src/lib/ops/change.spec.ts`, `schedule.spec.ts`, `records.spec.ts`, plus
  `removeLine` in `parse.spec.ts`.

### Different from the plan

- Only the **Schedule page** was moved onto the ops layer. The finance, day, notes, long-term,
  routines and people pages still save the old way. Their ops exist (`records.ts`) for the
  assistant to use. Move each page over when it's next touched; nothing depends on it.
- No `applyOperations(state, ops)` as named in schedule-chat.md §8; the same job is done by
  planners returning `Change[]` + `patch` + `run`.

### Checks run

- `npm run check`: 0 errors, 0 warnings.
- `eslint src`: clean. `prettier --check .`: clean.
- Unit tests (node): 150 passed. Browser component tests: 12 passed. E2E (`playwright test`,
  which also builds the app): 1 passed.
- Svelte MCP autofixer: **not run**. The Svelte MCP server couldn't connect from the cloud
  session (proxy refused). Run it on `src/routes/schedule/+page.svelte` and
  `src/routes/day/[date]/+page.svelte` next time it's available.
- Not tested by hand in a signed-in browser (no Firebase login in the build environment). Worth a
  quick click-through of the Schedule page: done/cancel/move/edit/remove an occurrence, cancel a
  week + Undo, week note, tasks, deadlines, timetable.

### Environment notes (cloud sessions)

- Run `npm ci` and `npm run gen` first (`npm run check` needs `worker-configuration.d.ts`).
- The pre-installed Chromium is a newer build than the project's Playwright expects. Point
  Playwright at it through a folder of symlinks:
  `mkdir -p $DIR && ln -sfn /opt/pw-browsers/chromium_headless_shell-1243 $DIR/chromium_headless_shell-1228 && ln -sfn /opt/pw-browsers/chromium-1243 $DIR/chromium-1228`,
  then run the tests with `PLAYWRIGHT_BROWSERS_PATH=$DIR`.

### Known gaps to remember

- The **person page** autosaves its name/bio textarea like the day page does its text. If the
  assistant appends to a bio while that page is open, the page's next autosave can overwrite it.
  Solve in Step 3 the same way as day text: a live-editor registry for open person pages.
- Undoing an appended line that mentions a new `@person` leaves the person's profile in place
  (same as deleting the line by hand).

---

## Step 1 — Providers and settings (done 2026-10-30)

### What was built

- **`src/lib/ai/types.ts`** — the provider-neutral shapes: `ToolDef` (with a `Schema` subset both
  providers accept: optional values are `type: [x, 'null']` and still listed in `required`),
  `ToolCall`, `ToolResult`, `Turn` (`user` text or `tool_results`), `SendRequest`, `RunResult`
  (`text`, `calls`, `stop: done | tool_use | max_tokens | refusal`, `usage`, `model`, `messages`),
  `Adapter`, and `AiError` with kinds `no_key | auth | rate_limit | bad_request | server | network`.
  - **History is provider-native and append-only**: `RunResult.messages` holds the user turn and
    the reply in the provider's own format; append both to the thread's `history` and never edit
    them (Claude thinking/fallback blocks and Gemini thought signatures must go back unchanged).
- **`providers/anthropic.ts`** — the official `@anthropic-ai/sdk` (1.3.0) with
  `dangerouslyAllowBrowser` and the transport's `fetch`. `client.beta.messages.create` with
  strict tools (`toClaudeSchema` closes objects, requires every property), top-level
  `cache_control`, and refusal fallback (`server-side-fallback-2026-07-01`, `fallbacks: 'default'`).
  No `thinking` param (Opus 5.5 thinks always; effort left at the default). Tool results go back
  in one user message. `listModels` via `client.models.list`.
- **`providers/gemini.ts`** — REST `generateContent` with `systemInstruction` and
  `functionDeclarations` (`toGeminiSchema`: one type + `nullable`). Calls without an id get a
  `local:` id that's never sent back. Safety finishes and blocked prompts → `refusal`.
  `listModels` pages through `/v1beta/models`, keeping `gemini*` models with `generateContent`.
- **`index.ts`** — `loadAdapter(provider)`, a dynamic import, so the SDK (~340 KB) only downloads
  once the assistant is used.
- **`transport.ts`** — `keyStatus()`, `saveKey(provider, key | null)`, `providerFetch(provider)`.
  - Web: key in `localStorage` (`daylog.ai.key.<provider>`), added as `x-api-key` /
    `x-goog-api-key` on the way out.
  - Desktop: `desktop.aiFetch` → Rust command `ai_fetch`, which adds the key from the OS
    credential store. A missing key surfaces as `AiError('no_key')` on both.
- **`src-tauri/src/ai.rs`** + commands `ai_fetch`, `ai_keys`, `ai_key_set` (in `commands.rs`,
  `lib.rs`, `build.rs`, `permissions/app.toml`). Keys via the `keyring` crate (Windows Credential
  Manager / macOS Keychain / Secret Service). `ai_fetch` only reaches `https://api.anthropic.com/`
  or `https://generativelanguage.googleapis.com/` for the matching provider, and strips any key
  or auth header the page tries to set. Rust unit tests cover both rules.
- **`config.ts`** — synced `AssistantConfig`: `name` (default **Jarvis**), `addressAs` (empty =
  first name), `checkins` (08:00 warm-up, 17:00 brief, 23:15 wrap-up kind; each `{ id, label,
time, kind, enabled }`), `quietHours` (00:00–07:30), `maxCardsPerDay` (5), `areas` (all on).
  `normalizeConfig` repairs anything stored badly. Helpers `addressName`, `inQuietHours`.
  Stored at `users/{uid}/assistant/config` via `loadAssistantConfig` / `saveAssistantConfig` in
  `db.ts`.
- **`device.ts`** — per-device `DevicePrefs`: `provider`, `models[provider][chat|background]`
  (defaults `claude-opus-5-5` / `claude-haiku-5-5`; `gemini-3.1-pro-preview` /
  `gemini-3.5-flash`, replaced by the live list on "Test connection"), `dailyTokens` (chat 1M,
  background 300k).
- **`budget.ts`** — `spentToday`, `recordUsage(slot, usage)`, `withinBudget(slot, prefs)`; cache
  reads count a tenth.
- **`storage.ts`** — guarded `localStorage` with an in-memory fallback.
- **`AssistantSettings.svelte`** in Settings: name + "Calls you" with a live greeting preview,
  provider switch, key save/remove, Test connection (lists models, fills both model pickers,
  keeps your picks if offered), daily limits with today's use, check-ins (on/off, time, name,
  kind, add/remove), quiet hours, suggestions per day, and "What it can see".

### Different from the plan

- The Claude adapter uses the **official SDK** rather than plain `fetch` (the SDK accepts a custom
  `fetch`, so the desktop key handling still works).
- Firestore layout: `assistant/config` is a doc in an `assistant` collection, so the assistant's
  other collections will be top-level siblings (`assistantInbox`, `assistantMemory`,
  `assistantThreads`, `assistantCheckins`); the plan's data table is updated.
- Check-ins are saved but **don't run yet** (Step 5). The Settings text says so.
- Assistant config is not part of the backup export yet.

### Checks run

- `svelte-check`: 0 errors, 0 warnings. `eslint .` and `prettier --check .`: clean.
- Vitest: 20 files, 187 tests passed (server + browser), including adapter tests against recorded
  responses, config/budget/key-storage tests, and a browser test of the Settings section (greeting,
  default check-ins, saving a key, test connection success and failure, removing the key).
- Rust: `cargo check` and `cargo clippy` clean (one older warning in `updater.rs`), `cargo test ai::`
  2 passed.
- `npm run build` and `vite build --mode desktop`: OK; the SDK is a lazily loaded chunk.
- **Not tested against the real APIs** (no keys in the build environment) and not clicked through
  in the desktop app. First real use: Settings → Assistant → paste a key → Test connection.
- Svelte MCP autofixer: still unreachable from the cloud session; not run.

### Environment notes (cloud sessions)

- Rust builds need the Linux packages from `docs/tauri-migration.md`
  (`apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
libxdo-dev libssl-dev libdbus-1-dev`); after that `cargo check` works in `src-tauri/`.

---

## Step 2 — Tool registry and chat (done 2026-10-30)

### What was built

- **`src/lib/ai/tools/registry.ts`** — `Tool { def, area, kind, describe, run }`.
  - `kind`: `read` (looks things up), `ui` (acts on the screen only: `open_page`), `write` (none
    yet; Step 3). Background runs (Step 5) must get `read` tools only.
  - `area` is a `DataArea` or `ui`; `toolsFor(config, tools)` drops areas switched off.
  - `runTool` checks the input against the schema (`validate`), fills missing nullable fields
    with null, and turns any failure into an error result the model can read. Results over 12k
    characters are cut with a note.
  - `ToolContext { uid, today, cache, navigate }`; `cached(ctx, key, load)` shares a fetch between
    tools in one turn. Helpers: `params`, `str`, `optStr`, `optInt`, `optEnum`, `dayKey`,
    `compact` (drops empty fields to save tokens), `weekday`.
- **Read tools** (one file per area, all in `tools/index.ts` → `ALL_TOOLS`, fixed order):
  - days: `read_day`, `search_days` (every word or an `@handle`, newest first, date range),
    `open_lines` (unfinished lines on the days before a date)
  - schedule: `schedule_snapshot` (occurrences with ids incl. untouched timetable rows, TBD events,
    tasks in range / overdue / later, deadlines with days left, week notes, timetable; defaults to
    this week and next, max two months)
  - people: `list_people` (with money balances), `get_person` (bio, balance, lend/borrow records,
    latest mentions)
  - notes: `search_notes`, `read_note`
  - long-term: `list_longterm`
  - routines: `routine_stats` (value, target met, streaks, last 7 days)
  - finance: `finance_summary` (month totals, pace against last month on the same day, top
    categories, account balances, who owes whom, currency), `find_transactions`
  - activity: `activity_day` (merges this computer's tracker, other computers and manual time like
    the Activity page; totals, top apps/sites with titles, goals, observations, best focus hours).
    New one-shot loaders in `db.ts`: `listActivityDocs`, `loadActivityConfig`, `loadActivityGoals`.
  - ui: `open_page` (day, schedule, people, notes, routines, finance, activity, settings, person,
    note)
- **`agent.ts`** — `runAgent`: send → run every tool call of the reply (in parallel) → send the
  results → … until a final answer, at most 8 tool rounds. Checks `withinBudget` before every call
  (`AiError('budget')`), `recordUsage` after. Returns the new history; a failed or step-limited
  exchange isn't kept, so the history always ends on a finished reply.
- **`prompt.ts`** — `SYSTEM_PROMPT`: fixed (cacheable) text with the JARVIS character, working
  rules (look things up, never guess; Sun–Thu week; currency from the finance tools; hidden
  areas; can read and open pages but **can't change anything yet**) and writing style (plain
  text, short, "- " bullets). `contextBlock` puts the date and time, its name, the form of
  address, the page being looked at and hidden areas in front of every message. `describeView`.
- **`assistant.svelte.ts`** — app state: `assistant { open, busy, step, name, address, entries,
pending }`, `openAssistant(question?)`, `closeAssistant`, `newConversation`, `ask(question, env)`.
  Uses the **chat** model; the conversation continues until "New conversation", or a change of
  provider or chat model.
- **`AssistantPanel.svelte`** — right-side panel: header with the orb (pulses while working), its
  name and the current step; messages with "what it looked at" under each answer; errors with an
  "Open Settings" link for missing key / rejected key / used-up budget; suggestions when empty;
  Enter sends, Shift+Enter is a new line.
- **Ways in:** `Ctrl+J` (anywhere, toggles), sidebar button on desktop and header button on the
  web (both show its name), "Ask the assistant" in the palette, `?question` in the palette, and
  `?question` in the **desktop quick bar** (opens the main window on today's page with
  `?ask=…`, which the layout turns into a question). Shortcuts list updated. New `sparkle` icon.

### Different from the plan

- Conversations live in memory only (gone on reload). Saving them (`assistantThreads`) fits with
  memory in Step 4.
- No markdown rendering: the prompt asks for plain text and the panel shows it as written.

### Checks run

- `svelte-check` 0/0, `eslint .` and `prettier --check .` clean.
- Vitest: 23 files, 212 tests passed, including the loop (tool round trip, step limit, budget,
  usage), validation, the prompt, tools against mocked data (days, schedule, finance, open_page),
  and a browser test of the panel (greeting, a question answered through `read_day`, follow-up
  keeps the history, missing key → Settings link). The panel test caught a real bug — the loop
  passed its growing history array to the adapter by reference; it now passes a copy.
- `npm run build`, `vite build --mode desktop`, e2e: OK.
- **Not tried against a real provider** (no key here) and not clicked through signed in. First
  real check: add a key, press `Ctrl+J`, ask "What's up today?".
- Svelte MCP autofixer still unreachable.

---

## Step 3 — Write tools, bubbles, approvals (done 2026-10-30)

### What was built

- **Registry** (`tools/registry.ts`): write tools have `kind: 'write'`, `plan(ctx, input) →
{ changes, summary }`, `small` and a `label` (for Settings). `runTool` hands plans to
  `ctx.propose` and returns its answer to the model; with no changes it says "nothing to change";
  without `propose` (background runs, Step 5) writes are refused. New schema helpers `num`,
  `optNum`, `optBool`, `strList`, `enumOf`.
- **26 write tools** (★ = small, applied at once by default):
  - days: `append_line`★, `set_line_done`, `move_line` (lines found by their text)
  - schedule: `set_event_status`, `move_event`, `update_event`, `add_event`,
    `cancel_week_classes`, `add_task`★, `set_task_status`, `move_task`, `update_task`,
    `add_deadline`, `update_deadline`, `set_week_note` (ids looked up fresh; untouched timetable
    rows resolved from `slot_date` ids; times must be `HH:MM`)
  - notes: `create_note`★, `append_to_note`★
  - long-term: `add_longterm`, `add_subtask`★, `set_subtask_done`, `set_longterm_done`
  - routines: `log_routine_value`★ (by name; remembers the old value for undo)
  - people: `append_person_note`, `set_person_name`
  - finance: `add_transaction` (accounts by name; asks which when several; lend/borrow need a
    person), `update_transaction`
- **`assistant.svelte.ts`**: `proposer` — `permissionFor(config, tool, small)` is `auto` → apply
  now (`commit` then `invalidateAll` so the page shows it), bubble with its name and Undo, a ✓ line
  in the chat with Undo; otherwise a `Card { summary, details, changes, status, always }`.
  `applyCard` (checks `staleChanges` first; "Always do this" saves `permissions[tool] = 'auto'`),
  `dismissCard`, `undoCard`, `undoAction`. What you did ("The owner applied/dismissed/undid: …")
  goes in front of your next message as "Since your last reply".
- **Config**: `permissions: Record<toolName, 'auto' | 'ask'>`, `permissionFor`.
- **Settings**: "Changes it makes without asking" — a checkbox per write tool.
- **Panel**: ✓ lines with Undo, cards with the changes in plain words, Apply / Dismiss /
  "Always do this without asking", and states (Applied + Undo, undone, dismissed, changed since).
- **Prompt**: a "Making changes" section — act when clear, small ones happen at once, others are
  cards, ids only from tools, ask when ambiguous, nothing is deleted, the schedule habits from
  schedule-chat.md, money rules, respect dismissed cards.
- **Ops**: `dayLine` changes can now rewrite a line (before and after both set);
  `capture.editDayLines` takes `{ from, to }` edits and the day page's editor has `replace`.
  `ops/describe.ts` (`describeChange`), `ops/fresh.ts` (`staleChanges`).
- **Open editors**: `src/lib/live.ts` — open note and person pages register; `commit` hands them
  the change and they save it like typing (fixes the Step 0 "person bio" gap). Day, note and
  person pages now keep their text when their data reloads for the same day/note/person, so the
  assistant's page refresh never wipes unsaved typing.
- **Toasts** take a `from` (the assistant's name, with the sparkle icon).
- **`docs/assistant/evals.md`**: 15 cases (schedule-chat.md §9 plus capture, money, routines,
  carry-over, ambiguity, dismissed cards).

### Different from the plan

- Cards have Apply / Dismiss, no Edit: to change a proposal, tell the assistant ("make it 3 PM")
  and it proposes again.
- No `update_slot` (permanent timetable changes) and no `set_day_goal` yet; both rare. Add them
  the same way if wanted.
- Cards live in the chat only (lost on reload) until the Inbox (Step 4) stores them.

### Checks run

- `svelte-check` 0/0, `eslint .`, `prettier --check .`: clean.
- Vitest: 26 files, 243 tests passed. New: write tools against mocked data (virtual timetable
  rows, bad ids, moves, times, accounts, lend without a person, routines, lines), the registry's
  write path, permissions, `staleChanges`, `describeChange`, `editDayLines` (with and without an
  open page), `commit` → open note/person pages, and browser tests of the panel (small addition
  applied + Undo, card applied → told to the model next turn, stale card refused, "always do
  this" saved) and the Settings list.
- `npm run build`, `vite build --mode desktop`, e2e: OK.
- Not tried against a real provider or clicked through signed in. Svelte MCP autofixer still
  unreachable.

---

## Step 4 — Memory and Inbox (done 2026-10-30)

### What was built

- **Memory** (`src/lib/ai/memory.ts`): `MemoryItem { id, text, kind: preference | fact,
updatedAt }` in `assistantMemory/{id}` (`listMemory`, `saveMemory`, `deleteMemory`,
  `newMemoryId` in `db.ts`). `memoryBlock` builds the `<memory>` block (preferences first, newest
  first, about 4,000 characters, then "N more — use recall"); `searchMemory`, `cleanMemoryText`
  (one line, at most 300 characters).
  - New change kind `memory` in the ops layer (`change.ts`, `commit.ts`, `fresh.ts`,
    `describe.ts`), so memory goes through the same apply / Undo / freshness path.
  - Tools (`tools/memory.ts`, area `assistant`, always available): `remember`★ (new, or a
    correction with `replaces: id`; the same text twice is "nothing to change"), `forget` (a
    card), `recall` (read).
  - The `<memory>` block goes in front of a conversation's **first** message only (after the
    context block). Later `remember` calls are in the history anyway.
  - Settings → Assistant → "What it remembers": list (kind + text), Edit inline, Forget, and an
    Add row with a kind picker. Settings writes straight to `db.ts`, not through ops.
- **Inbox** (`src/lib/ai/inbox.ts` pure, `inbox.svelte.ts` state):
  - `InboxItem { id, kind: proposal | brief, source: chat | checkin, title, body, tool, details,
changes, status, signalKey, priority, createdAt, expiresAt }` in `assistantInbox/{id}`;
    `changes` are stored as a JSON string (their documents can hold values Firestore won't store).
  - `startInbox(uid)` (from the layout, not in the quick bar) keeps `inbox.items` live with
    `watchInbox` and, on the first snapshot, deletes cards settled 30 days ago or expired 30
    days ago. `pendingItems` = pending and unexpired, by priority then newest.
  - `applyItem` / `dismissItem` / `undoItem` replaced the chat-only `applyCard` / `dismissCard` /
    `undoCard`: same freshness check, "always do this", bubble with Undo; status saved to
    Firestore so every device sees it. `applyChanges` and the "what you did" outcomes moved here
    (`noteOutcome`, `outcomesSoFar`, `forgetOutcomes`).
  - Chat proposals become Inbox cards (`source: 'chat'`, expire after 7 days); chat entries
    keep only card ids.
  - `InboxCard.svelte` (one card; briefs show their body and Dismiss only) and
    `InboxList.svelte` (pending cards, which stay in view after you act on them until you leave
    the page). Shown at the top of the assistant panel ("Waiting for you", minus cards already in
    the conversation) and at the top of **today's** Plan panel ("From Jarvis").
- **Saved conversations**: `assistantThreads/{id}` holds `{ provider, model, history, entries,
updatedAt }` (JSON strings). Saved after every message and every Undo. The panel calls
  `restoreConversation` once per account: the latest conversation is picked up if it was used in
  the last 12 hours; only the newest 20 are kept. History past 600 KB isn't saved (the next
  message starts the provider afresh, the messages still show); entries are trimmed from the
  oldest past 250 KB. A provider/model switch keeps the conversation id and messages but starts
  a fresh history (and sends memory again).
- **Prompt**: a "Memory" section — follow preferences, remember lasting preferences and facts
  the app doesn't hold without asking, don't store tasks/events/money/notes or one-off plans,
  correct with `replaces` or `forget`. The changes section says cards also wait in the Inbox.
- **Evals**: cases 16–20 (remember, use in a new conversation, correct, forget, don't remember
  tasks).

### Different from the plan

- Memory kinds are `preference` and `fact`; no `summary` kind or `source` field yet (nothing
  writes summaries until the weekly review in Step 6).
- `forget` deletes the memory (the only delete the assistant has); it's a card by default and can
  be undone.
- The Inbox on the day page shows only on **today's** page.
- Briefs (`kind: 'brief'`) are supported by the card but nothing creates them yet (Step 5/6).
- No "Don't suggest this again" button yet: it belongs with `signalKey` dedupe and feedback in
  Step 5.
- Assistant memory, Inbox and conversations are not in the backup export (nor is the config).

### Checks run

- `svelte-check` 0/0, `eslint .`, `prettier --check .`: clean.
- Vitest: 29 files, 260 tests passed. New: `memory.spec.ts`, `inbox.spec.ts`, memory tools in
  `tools.spec.ts`, `commit` remembering/forgetting, panel tests (proposals saved to the Inbox and
  dismissed there, conversation saved with card ids and history, memory only in the first
  message, Inbox cards from elsewhere shown and applied), a reload test
  (`AssistantPanel.restore.svelte.spec.ts`: latest conversation shown and continued with its
  history), and the Settings memory list (add, edit, forget).
- `npm run build`, `vite build --mode desktop`, e2e: OK.
- Not tried against a real provider or clicked through signed in. Svelte MCP autofixer still
  unreachable from the cloud session.

---

## Step 5 — Proactive engine, in seven parts

Split on 2026-10-30 so each part can be built, tested and merged on its own. Do them in order.
The real check-in contents (warm-up, briefs) and most detectors stay in Step 6; Step 5 builds the
engine and two detectors that prove it.

| Part   | What                              | Done when                                                                                           |
| ------ | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| 5.1 ✅ | Background runs                   | "Run now" next to a check-in in Settings fills the Inbox with a brief and any proposals             |
| 5.2    | When to run (pure scheduler)      | unit tests: due, missed earlier today, already done, quiet hours, daily card limit                  |
| 5.3    | One device at a time (lease)      | with two tabs/devices open only one runs a check-in; closing it lets another take over              |
| 5.4    | Web triggers                      | a tab left open past 17:00 gets the brief                                                           |
| 5.5    | Desktop wake-ups (`assistant.rs`) | the desktop app in the tray delivers the 08:00 warm-up on time                                      |
| 5.6    | Detectors + `schedule_checkin`    | unit tests per detector; a carried-over line gives one card, not one per run                        |
| 5.7    | Notifications + feedback          | a muted suggestion stops coming back; a card in quiet hours shows in the Inbox with no notification |

### 5.1 — Background runs

- `runCheckin(uid, checkin)`: the **background model**, a fresh conversation, read tools plus write
  tools whose changes are **collected, never applied** (each becomes an Inbox card,
  `source: 'checkin'`); no `ui` tools. The final answer becomes a **brief** card.
- Instructions per check-in kind in the message (the system prompt stays cacheable), from
  decisions.md → "What each check-in covers".
- Background token budget; `signalKey` `checkin:<id>:<date>` on the brief, for 5.2's dedupe.
- Settings: "Run now" per check-in.

**Done 2026-10-30.** Built:

- `src/lib/ai/checkin.ts` — `runCheckin(uid, checkin, displayName, now?) → { brief, proposals }`.
  Background model and token budget, empty history, `<context>` (view: "a scheduled check-in")
  - `<memory>` + the check-in message. Tools: everything the areas allow except `ui` tools and
    the memory tools (nobody to confirm a memory). `propose` saves each change as an Inbox
    proposal (`source: 'checkin'`, same `signalKey`) and tells the model it's a card; nothing is
    applied, small additions included. The answer becomes a brief card titled
    "<label> · Fri 30 Oct", priority 1, shown for 18 hours; an empty or refused answer leaves none.
- `prompt.ts` — `checkinMessage(checkin)`: what each kind covers (warm-up / brief / wrap-up, from
  decisions.md), status-report style of at most ~10 lines, propose only clear help (carry-overs
  with `move_line`), no questions.
- Settings → Check-ins: "Run now" per row (toast: "Added a brief and 2 proposals to your
  Inbox", or the error). The "don't run yet" note now points to Run now.
- Tests: `checkin.spec.ts` (small additions become cards and nothing is committed; brief fields
  and key; background model, fresh history, no `open_page`/`remember`; refusal leaves no brief)
  and a Settings test for Run now. Totals: 30 files, 264 tests; lint, types, both builds OK.
- Not run against a real provider. First real check: Settings → Check-ins → Run now on the
  evening brief, then look at today's page.

### 5.2 — When to run

- Pure `dueCheckins(config, now, done)`: enabled check-ins whose time has passed today and that
  haven't run today (a missed one still runs the same day). Quiet hours hold notifications, not
  runs.
- `assistantCheckins/{date_id}` records each run (`{ at, device, status }`) so it never runs
  twice; daily cap counts unprompted cards (`maxCardsPerDay`).

### 5.3 — Lease

- `assistant/lease { deviceId, kind: desktop | web, until }`, taken in a Firestore transaction,
  renewed every minute while open, lasting 3 minutes. Desktop beats web; web takes over an
  expired lease.

### 5.4 — Web triggers

- On open, on tab visible (at most every 15 minutes), and a 1-minute timer while open: if this
  tab holds the lease, run what's due.

### 5.5 — Desktop wake-ups

- `src-tauri/src/assistant.rs`: wake at the next check-in time (like `reminders.rs`) and tell the
  webview, so a hidden window still runs it.

### 5.6 — Detectors and self-scheduled check-ins

- `src/lib/ai/detectors/*.ts`: pure `(data, now, config) → Signal[]` with a stable `signalKey`.
  First two: lines carried over from yesterday, a deadline ≤ 5 days away with no tasks.
- New signals (not already in the Inbox) start a short background run between check-ins.
- `schedule_checkin` tool + `assistantCheckins` entries it creates.

### 5.7 — Notifications and feedback

- Desktop notifications for high-priority cards, none in quiet hours.
- "Don't suggest this again" on cards; `assistant/feedback` counts applied / dismissed / muted per
  signal type, checked by detectors.
