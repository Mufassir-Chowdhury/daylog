# Assistant — progress log

Where the build stands, so any chat can pick up from here. Read [the plan](../../assistant.md)
and [decisions](./decisions.md) first. Research notes: [research.md](./research.md).

**Update this file at the end of every step**: tick the step, list what was built, note anything
that differs from the plan, and say what comes next.

| Step | What                            | Status                |
| ---- | ------------------------------- | --------------------- |
| 0    | Ops layer                       | ✅ done 2026-10-30    |
| 1    | Providers and settings          | ⏭ **next**            |
| 2    | Tool registry and chat          | not started           |
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

## Next: Step 1 — Providers and settings

See the plan, §5 Step 1. Checklist:

- [ ] `src/lib/ai/types.ts`
- [ ] `src/lib/ai/providers/anthropic.ts` + `gemini.ts` (+ fixture tests)
- [ ] `src/lib/ai/transport.ts` (web fetch / desktop Tauri command)
- [ ] `src-tauri/src/ai.rs` with `keyring`; bridge in `desktop.ts` / `desktop-tauri.ts`
- [ ] `src/lib/ai/budget.ts`
- [ ] `src/lib/ai/config.ts` with defaults from decisions.md
- [ ] Settings → Assistant section
- [ ] Re-check model ids and API details (research.md §3) before writing the adapters
