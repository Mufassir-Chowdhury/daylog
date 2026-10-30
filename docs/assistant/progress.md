# Assistant — progress log

Where the build stands, so any chat can pick up from here. Read [the plan](../../assistant.md)
and [decisions](./decisions.md) first. Research notes: [research.md](./research.md).

**Update this file at the end of every step**: tick the step, list what was built, note anything
that differs from the plan, and say what comes next.

| Step | What                            | Status                |
| ---- | ------------------------------- | --------------------- |
| 0    | Ops layer                       | ✅ done 2026-10-30    |
| 1    | Providers and settings          | ✅ done 2026-10-30    |
| 2    | Tool registry and chat          | ⏭ **next**            |
| 3    | Write tools, bubbles, approvals | not started           |
| 4    | Memory and Inbox                | not started           |
| 5    | Proactive engine                | not started           |
| 6    | Feature packs                   | not started           |
| 7    | Evaluation and tuning           | not started           |
| —    | Voice mode (ElevenLabs)         | future, not scheduled |

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

## Next: Step 2 — Tool registry and chat

See the plan, §5 Step 2, and decisions.md → Persona (the system prompt should carry it). Checklist:

- [ ] `src/lib/ai/tools/registry.ts` — `defineTool({ name, area, kind, small, schema, describe, run })`;
      tools of areas switched off in config are left out
- [ ] Read tools for each area, trimmed JSON output
- [ ] `src/lib/ai/agent.ts` — loop over `Adapter.send` (max ~8 steps); check `keyStatus` and
      `withinBudget` first, `recordUsage` after every call; append `RunResult.messages` to history
- [ ] `src/lib/ai/prompt.ts` — fixed JARVIS system prompt; date, page, memory, name and
      `addressName()` in the user turn
- [ ] `AssistantDrawer.svelte` (`Ctrl+J`), `?` prefix in `CommandPalette.svelte`, shortcut in the `?` list
- [ ] Threads: keep per provider; a provider switch starts a new thread
