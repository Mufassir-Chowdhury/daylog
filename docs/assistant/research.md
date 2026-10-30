# Assistant — research notes

What was found while designing the assistant, so a later session doesn't have to look it up again.
Gathered 2026-10-30 from web search (the docs sites themselves couldn't be fetched from the build
environment, so most of this comes from help pages and press coverage quoted in search results).
**Re-check API details and model ids before building on them.**

Part of the assistant docs: [plan](../../assistant.md) · [decisions](./decisions.md) ·
[progress](./progress.md).

---

## 1. The two products "the assistant" is modelled on

### Grok Bot (SpaceXAI + Cursor, 2026)

A separate product from the Grok chat assistant: named, persistent AI "teammates" that work in your
apps. Desktop (macOS, Windows), iPhone and Android; needs a SuperGrok / Cursor plan.

- **Routines** — scheduled runs that keep going in the cloud while your laptop is closed. A bot can
  create a routine from a chat request ("check X every morning").
- **Memory** — keeps stable preferences, important facts and summaries. The docs say memory is
  _not_ a substitute for an authoritative source: before consequential decisions the bot reopens
  current data. You can inspect or correct memory by asking in chat.
- **Approvals** — consequential actions (sending, purchases, deletions) appear as cards with
  **Allow once / Always allow / Deny**. Auto-review settings choose which kinds need approval. A
  third-party guide says approval requests raised by a routine or another bot lapse after ~10
  minutes and the action doesn't run (not confirmed in official docs).
- **Background turns** keep running when you close the app.
- There's no built-in "heartbeat"; people build one as a scheduled routine that reads a notes file,
  researches read-only and writes checkpoints for review.

### dots (OpenAI, launched at DevDay, late Sept 2026)

An always-on personal agent in ChatGPT (Pro tier at launch).

- **Proactive research** — on a cadence, while you're not talking to it, the dot reviews what it
  knows about you, the conversation history and the connected resources, then researches what it
  could do to help and **proposes** those ideas. This mode is **read-only**: it "doesn't send
  messages, change connected apps, or control a browser or computer". Results show up in the dot's
  activity view, not as direct messages.
- **Scheduled check-ins / reminders** — you ask for them in chat; each shows up as a task whose
  repeat schedule, time and completion notifications you can edit.
- A dot can decide when to pause and when to wake up again.
- Its own cloud computer with a browser you can watch; optionally it can control your computer.
- **Criticism**: early testers found the timing and usefulness of proactive suggestions uneven
  (noise). OpenAI says timing will improve.

### What daylog takes from them

| From             | Idea                                     | daylog version                                                                |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| Grok Bot         | Named persistent assistant               | Changeable name in Settings                                                   |
| Grok Bot         | Routines                                 | Scheduled check-ins (08:00 / 17:00 / 23:15) + `schedule_checkin` tool         |
| Grok Bot         | Memory ≠ source of truth                 | Memory holds preferences/facts; every run rereads Firestore                   |
| Grok Bot         | Allow once / Always allow / Deny         | Proposal cards; small additions auto-apply with an Undo bubble                |
| dots             | Read-only proactive research → proposals | Background runs get read tools only and must answer with cards                |
| dots             | Activity feed                            | Inbox (Firestore, synced to every device)                                     |
| dots (criticism) | Noisy timing                             | Local detectors gate every LLM run; caps, quiet hours, dedupe, mute, feedback |

---

## 2. Facts about daylog that shape the design

Found by reading the code on 2026-10-30.

- **Client-only app.** SvelteKit with `ssr = false`; all data goes browser → Firestore. Firestore
  rules allow `users/{uid}/**` for the signed-in owner, so new `users/{uid}/assistant/...`
  collections need **no rules change**.
- **The desktop app has no server.** `vite build --mode desktop` uses `adapter-static`, served by
  Tauri from `http://localhost:47615`. So a SvelteKit `+server.ts` route (the approach in
  [`schedule-chat.md`](../../schedule-chat.md)) would only exist on the Cloudflare web build. That
  is why the assistant calls the provider from the client.
- **Hidden webviews throttle timers.** That's why reminders live in Rust (`src-tauri/src/reminders.rs`)
  and the webview only hands over the list (`src/lib/reminders.ts`). The assistant's tick should
  come from Rust the same way.
- **Rust already has an HTTP client** (`ureq` with native TLS) and a notification module
  (`notify.rs`).
- **Saving is scattered.** Each page owns its own `put…`/`drop…` helpers that update local state,
  call `db.ts`, and build an undo toast by hand (`src/routes/schedule/+page.svelte` is the biggest).
  Step 0 pulls this into `src/lib/ops/`.
- **Day text and the live editor.** An open day page autosaves its whole text, so writing a day doc
  behind its back gets overwritten. `src/lib/capture.ts` routes appends through the open page.
  Removing a line (undo) has to go the same way.
- **Toasts** (`src/lib/toast.svelte.ts`) already support an Undo button; at most 3 on screen.
- **Week** runs Sun–Thu (academic week); ids for untouched timetable occurrences are deterministic
  (`overrideId(slotId, date)`) and "virtual" until saved.

---

## 3. LLM providers

### Claude (Anthropic Messages API)

Details from [`schedule-chat.md`](../../schedule-chat.md) (checked 2026-10-10), still the reference:

| Model             | ID                  | Input $/1M | Output $/1M | Use as               |
| ----------------- | ------------------- | ---------- | ----------- | -------------------- |
| Claude Opus 5.5   | `claude-opus-5-5`   | $4.00      | $20.00      | chat (best quality)  |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2.00      | $10.00      | chat (default)       |
| Claude Haiku 5.5  | `claude-haiku-5-5`  | $0.10      | $0.50       | background (default) |

- Calling from a browser: send header `anthropic-dangerous-direct-browser-access: true` (plus
  `x-api-key`, `anthropic-version`). Fine here because it's the user's own key in their own browser.
- Opus 5.5: thinking is always on (no `thinking: disabled`, no `budget_tokens`; use
  `output_config.effort`), forced `tool_choice` is rejected, no assistant prefill, check
  `stop_reason === 'refusal'`.
- Tools can be `strict: true` (input guaranteed to match the schema).
- Multi-turn tool use: assistant content (including thinking blocks) must be sent back unchanged.
- Prompt caching works on an exact prefix (tools → system → messages): keep tools and system text
  fixed; put dates, ids and memory in the user message.
- `GET /v1/models` lists models available to the key.

### Gemini (Google `generativelanguage.googleapis.com`)

- `POST /v1beta/models/{model}:generateContent`, key in `x-goog-api-key`. Callable from the browser.
- Tools: `tools: [{ functionDeclarations: [{ name, description, parameters }] }]`; the reply has
  `candidates[0].content.parts[].functionCall { name, args }`; answer with a `user`-role part
  `functionResponse { name, response }`. Roles are `user` / `model`; system text goes in
  `systemInstruction`.
- `parameters` accepts a subset of OpenAPI schema. Stick to object / string / number / integer /
  boolean / array / enum and `nullable`; avoid `oneOf`, `$ref`, `additionalProperties`.
- Newer models return **thought signatures** with function calls; they must be passed back
  unchanged in the next turn (same rule as Claude's thinking blocks) — so store raw provider parts.
- No strict-schema guarantee: validate every argument and id.
- `GET /v1beta/models` lists models; pick a Pro-tier model for chat and a Flash-tier one for
  background (Flash has a free quota). Don't hard-code ids.

### Conclusion

Switchable with a narrow adapter (messages, tool definitions, tool calls/results) and plain `fetch`
— see the plan, §3.

---

## 4. ElevenLabs (future voice mode)

Secondhand (third-party docs in search results) — **verify at docs.elevenlabs.io before building**.

- **Speech-to-text**: _Scribe v2 Realtime_ (`scribe_v2_realtime`), streaming over WebSocket,
  ~150 ms latency, 90+ languages, PCM 16 kHz input, voice-activity-based commits. Listed around
  $0.39 per hour of audio (may be out of date).
- **Browser auth**: the documented pattern is a **short-lived single-use token** created server-side
  from the API key; the key itself should never be in client code. For daylog that means: on
  desktop, Rust holds the key and mints tokens; on web, either the user accepts a key in local
  storage (same trade-off as the LLM key) or a tiny Worker route mints tokens.
- **Text-to-speech**: multilingual models (e.g. `eleven_multilingual_v2`), with REST and WebSocket
  streaming; key header `xi-api-key`.
- There's also a hosted "conversational agent" product, but daylog should keep its own LLM loop and
  use ElevenLabs only for ears and voice, so tools, memory and approvals stay the same in voice mode.

---

## Sources

- [Grok Bot Tutorial: Skills, Routines, and Approvals (DataCamp)](https://www.datacamp.com/tutorial/grok-bot-tutorial)
- [Grok Bot — Routines (Cursor help)](https://cursor.com/help/grok-bot/routines.md)
- [Work with Grok Bot (Cursor docs)](https://cursor.com/docs/grok-bot/work)
- [Grok Bot settings and notifications (xAI docs)](https://docs.x.ai/grok-bot/settings-and-notifications.md)
- [Giving Grok Bot its first job (DEV Community)](https://dev.to/joey_zou_63aa6b1f1cbaa2bb/giving-grok-bot-its-first-job-one-role-one-brief-approvals-before-autonomy-1mp6)
- [What is Grok Bot (i-scoop)](https://www.i-scoop.eu/what-is-grok-bot-how-xais-ai-teammates-finish-real-work-in-your-apps/)
- [Introducing dots (OpenAI)](https://openai.com/index/introducing-dots/)
- [Getting started with your dot (OpenAI Help)](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot)
- [How OpenAI turned its coding tools into dots (TechCrunch)](https://techcrunch.com/2026/10/26/how-openai-turned-its-coding-tools-into-dots-an-always-on-personal-assistant/)
- [OpenAI launches dots (Al Jazeera)](https://www.aljazeera.com/economy/2026/9/30/openai-launches-dots-personal-ai-assistant-built-to-handle-everything)
- [OpenAI Dots take on Meta Muse and Grok Bot (iPhone in Canada)](https://www.iphoneincanada.ca/2026/09/29/openai-dots-take-on-meta-muse-and-grok-bot-with-24-7-ai-agents/)
- [Scribe v2 Realtime (LLM Reference)](https://www.llmreference.com/model/scribe-v2-realtime/elevenlabs)
- [ElevenLabs provider notes (OpenClaw docs)](https://docs.openclaw.ai/providers/elevenlabs.md)
