# Schedule chat box — implementation notes

A plan for adding "tell Claude what changed" to the Schedule page, the way the routine was kept up
to date in the original Claude chat ("Monday SWE is cancelled", "DM grading is done", "Wednesday
lab moves to Thursday, room 304"). Nothing here is built yet. The data model and the manual
controls it builds on are already in place (`src/lib/schedule.ts`, `src/lib/db.ts`,
`src/routes/schedule/+page.svelte`).

Model ids, prices and API details were checked on 2026-10-10. Check them again before building.

---

## 1. How it fits together

```
Schedule page (browser)
  │  message + snapshot of the schedule + Firebase ID token
  ▼
POST /api/schedule-chat          ← new SvelteKit +server.ts, runs on the Cloudflare Worker
  │  verifies the ID token, calls Claude with tools, holds the API key
  ▼
Claude (Messages API, tool use)
  │  tool_use blocks = proposed operations ("mark done", "move", "add task", …)
  ▼
/api/schedule-chat returns { reply, operations[] }
  ▼
Schedule page shows a preview → "Apply" → existing db.ts save functions write to Firestore
                                        → one "Undo" toast reverts the whole batch
```

Why the server doesn't write to Firestore itself:

- The app is client-only. Firestore rules let only the signed-in user write their own data, and the
  Firebase Admin SDK doesn't run on Cloudflare Workers.
- The browser already has every save function (`saveEvent`, `saveTask`, …), offline persistence
  and undo. The server only needs to turn text into operations.
- You get a preview step for free. Claude proposes, and you confirm.

So the server route is stateless: it gets the snapshot, asks Claude, and returns the operations.

---

## 2. Setup

### API key

1. Create a key at https://platform.claude.com (Settings → API keys). Set a monthly spend limit
   on it.
2. Production: `npx wrangler secret put ANTHROPIC_API_KEY`
3. Local dev: create `.dev.vars` (add it to `.gitignore`) containing
   `ANTHROPIC_API_KEY=sk-ant-...`
4. Run `npm run gen` (`wrangler types`) so `platform.env.ANTHROPIC_API_KEY` is typed. Then make
   sure `src/app.d.ts` declares
   `interface Platform { env: Env }` (the type `wrangler types` generates).

The key must never reach the browser. Read it only in `+server.ts`, through `platform.env`. Don't
put it in `$env/static/public` or in `firebase-config.ts`.

### Packages

```bash
npm install @anthropic-ai/sdk jose
```

- `@anthropic-ai/sdk` runs on Workers, since it uses `fetch`. If the build complains about Node
  built-ins, add `"compatibility_flags": ["nodejs_compat"]` to `wrangler.jsonc`.
- `jose` verifies the Firebase ID token on the Worker (step 3).

### `ssr = false` doesn't affect this

`export const ssr = false` in `src/routes/+layout.ts` only stops pages from rendering on the
server. A `+server.ts` endpoint still runs on the Worker.

---

## 3. Authenticating the request

Without this check, anyone could spend your API credit through the endpoint.

Client: send `Authorization: Bearer ${await session.user!.getIdToken()}`.

Server: verify the token against Google's public keys. The Firebase project id is in
`src/lib/firebase-config.ts`.

```ts
// src/lib/server/verify-firebase.ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
	new URL(
		'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
	)
);

/** Returns the uid, or throws. */
export async function verifyIdToken(token: string, projectId: string): Promise<string> {
	const { payload } = await jwtVerify(token, JWKS, {
		issuer: `https://securetoken.google.com/${projectId}`,
		audience: projectId
	});
	if (!payload.sub) throw new Error('no subject');
	return payload.sub;
}
```

If only you use the app, also check `payload.sub` (or `payload.email`) against an allowlist in a
Worker variable. Then nobody else who signs in can use your key.

---

## 4. Which model

| Model             | ID                  | Input $/1M | Output $/1M | Rough cost per message\* |
| ----------------- | ------------------- | ---------- | ----------- | ------------------------ |
| Claude Opus 5.5   | `claude-opus-5-5`   | $4.00      | $20.00      | ~$0.06                   |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2.00      | $10.00      | ~$0.03                   |
| Claude Haiku 5.5  | `claude-haiku-5-5`  | $0.10      | $0.50       | < $0.002                 |

\*Assumes about 8K input tokens (two weeks of schedule, tasks and deadlines, plus the tool
definitions) and about 1.5K output tokens. Caching (step 7) lowers the input side.

**Default: `claude-opus-5-5`.** It handles the vague messages best, such as "the Wednesday lab
is shifted to Thursday, same time, room 304", "thursday class is taken" or "I don't have to
grade the Excel exam now". Those need reasoning about which entry is meant and what else
changes with it. Once the chat works, try `claude-sonnet-5-5` on the same set of messages
(step 9). If it gets them right, it halves the cost. Make the model a constant at the top of
the route so it's a one-line change.

Things that differ from older Claude models and will give a 400 if you get them wrong:

- **Thinking is always on** for Opus 5.5. Don't send `thinking: { type: 'disabled' }` or
  `budget_tokens`. Control depth with `output_config: { effort: 'low' | 'medium' | 'high' }`.
  The default is `medium`, which suits this. Try `low` if replies are slow.
- **Forced tool choice is rejected** (`tool_choice: { type: 'any' }` or `{ type: 'tool' }`). Use
  the default `auto`, tell the model in the system prompt to use the tools, and set `strict: true`
  on each tool.
- **No assistant prefill.** Don't end `messages` with an `assistant` turn.
- **Refusals.** Check `stop_reason === 'refusal'` before reading the content. For Opus 5.5, also
  opt in to server-side fallback (step 6), so that a false-positive safety decline is retried on
  another model.

---

## 5. Tools: one per kind of change

Each tool is **strict** (`strict: true`, `additionalProperties: false`, every property listed in
`required`; optional values are typed as nullable). Strict mode guarantees that each `tool_use.input` matches its
schema exactly. The model can call several tools in one reply, for example "cancel SWE, mark DM
grading done, add Mercor 2h on Thursday", and you get them all at once.

The route never runs these tools. It just collects the `tool_use` blocks and returns them as
operations.

| Tool                  | Input                                                                                  | Applies as (existing code)                                                             |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `set_event_status`    | `id`, `status` (`planned`/`done`/`cancelled`), `note` \| null                          | `putEvent({ ...event, status, note })`                                                 |
| `move_event`          | `id`, `date`, `start`, `end`, `room`                                                   | `moveEvent(event, target, newId)` → save both (or set the date directly if it was TBD) |
| `update_event`        | `id`, then `title`, `start`, `end`, `room`, `note`, `kind` (each nullable = unchanged) | `putEvent({ ...event, ...changes })`                                                   |
| `add_event`           | `title`, `kind`, `date` \| null (TBD), `start`, `end`, `room`, `note`                  | `putEvent({ id: newScheduleId(uid, 'events'), slotId: null, status: 'planned', … })`   |
| `cancel_week_classes` | `week` (Sunday date)                                                                   | `weekOff(week, occurrences)`                                                           |
| `add_task`            | `text`, `date` \| null (Later), `until` \| null, `start`, `end`, `highlight`           | `addTask(...)`                                                                         |
| `set_task_status`     | `id`, `status` (`open`/`done`/`dropped`), `note` \| null                               | `putTask({ ...task, status, note })`                                                   |
| `move_task`           | `id`, `date` \| null, `until` \| null                                                  | `moveTask(task, target, newId, Date.now())` → save both                                |
| `update_task`         | `id`, `text`, `start`, `end`, `note`, `highlight` (nullable = unchanged)               | `putTask({ ...task, ...changes })`                                                     |
| `add_deadline`        | `text`, `due` \| null, `label`, `hard`, `note`                                         | `putDeadline(...)`                                                                     |
| `update_deadline`     | `id`, `done`, `due`, `label`, `hard`, `note` (nullable = unchanged)                    | `putDeadline({ ...deadline, ...changes })`                                             |
| `set_week_note`       | `week`, `text`                                                                         | `setWeekNote(week, text)`                                                              |
| `update_slot`         | `id`, changes to the weekly timetable (rare — "SWE moves to room 812 for good")        | `putSlot(...)`                                                                         |

Example definition:

```ts
import type Anthropic from '@anthropic-ai/sdk';

const setEventStatus: Anthropic.Tool = {
	name: 'set_event_status',
	description:
		'Mark one schedule entry (a class occurrence or one-off event) as done, cancelled, or back to planned. ' +
		'Use the exact id from the schedule snapshot. For a class that moves to another day or room, use move_event instead.',
	strict: true,
	input_schema: {
		type: 'object',
		additionalProperties: false,
		required: ['id', 'status', 'note'],
		properties: {
			id: {
				type: 'string',
				description: 'Entry id from the snapshot, e.g. "seed-swe-mon_2026-10-05".'
			},
			status: { type: 'string', enum: ['planned', 'done', 'cancelled'] },
			note: {
				type: ['string', 'null'],
				description: 'Short reason, or null to keep the current note.'
			}
		}
	}
};
```

### Ids for timetable occurrences

A class that hasn't been changed yet has no stored document. It's "virtual" (`Occurrence.virtual`).
Its id is already deterministic, though: `overrideId(slotId, date)`, e.g.
`seed-swe-mon_2026-10-05`. `occurrences()` gives every row that id, so:

- put `event.id` in the snapshot for every row, virtual or not;
- on the client, look the id up in the current `occurrences(...)` result (not in `events`), and
  save the whole materialized event. Saving the override and editing an existing one are then the
  same code path.

Validate every id the model returns against the snapshot. Drop unknown ids and show them as
"couldn't find …".

---

## 6. The route

```ts
// src/routes/api/schedule-chat/+server.ts
import Anthropic from '@anthropic-ai/sdk';
import { error, json } from '@sveltejs/kit';
import { firebaseConfig } from '$lib/firebase-config';
import { verifyIdToken } from '$lib/server/verify-firebase';
import { SYSTEM_PROMPT, TOOLS } from '$lib/server/schedule-chat-tools';
import type { RequestHandler } from './$types';

const MODEL = 'claude-opus-5-5';

export const POST: RequestHandler = async ({ request, platform }) => {
	const auth = request.headers.get('authorization')?.replace(/^Bearer /, '');
	if (!auth) error(401, 'Sign in first');
	try {
		await verifyIdToken(auth, firebaseConfig.projectId);
	} catch {
		error(401, 'Sign in first');
	}

	const { message, snapshot, history } = await request.json();
	// Size guard: the snapshot is ~10 KB; anything huge is a bug or abuse.
	if (typeof message !== 'string' || message.length > 4000) error(400, 'Message too long');

	const client = new Anthropic({ apiKey: platform!.env.ANTHROPIC_API_KEY });

	const response = await client.beta.messages.create({
		model: MODEL,
		max_tokens: 16000,
		output_config: { effort: 'medium' },
		// Retries a false-positive safety decline on another model inside the same call.
		betas: ['server-side-fallback-2026-07-01'],
		fallbacks: 'default',
		cache_control: { type: 'ephemeral' },
		system: SYSTEM_PROMPT, // fixed text: no dates, no ids (see step 7)
		tools: TOOLS,
		messages: [
			...history, // earlier turns of this chat, if you keep any
			{
				role: 'user',
				content: [
					{ type: 'text', text: `<schedule>\n${JSON.stringify(snapshot)}\n</schedule>` },
					{ type: 'text', text: message }
				]
			}
		]
	});

	if (response.stop_reason === 'refusal')
		return json({ reply: "Couldn't process that one — try rephrasing.", operations: [] });

	const operations = response.content
		.filter((b) => b.type === 'tool_use')
		.map((b) => ({ tool: b.name, input: b.input }));
	const reply = response.content
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.join('\n');

	return json({ reply, operations });
};
```

- The response's `tool_use` inputs are already parsed objects. Don't string-match on them.
- Catch SDK errors from the most specific type down (`Anthropic.RateLimitError` →
  `Anthropic.APIError`) and turn them into readable messages. A Worker request isn't held open
  forever, but at `medium` effort a single non-streaming call is normally a few seconds.
- If replies get slow, switch to `client.beta.messages.stream(...)` and `await stream.finalMessage()`.
  When streaming with your own tools, set `eager_input_streaming: true` on each tool and validate
  every input against its schema yourself before returning it.

### Multi-turn chat (optional)

For follow-ups such as "no, the other one", keep `history` on the client. After each reply,
append the assistant's full `content` unchanged, including thinking blocks, which must be passed
back exactly as received. Then append a `user` turn with one `tool_result` per `tool_use`
(`"applied"` or `"skipped by user"`). Never edit or delete earlier turns. Opus 5.5 rejects
history whose earlier turns were changed. If the history gets long, start a new chat rather than
trimming it.

---

## 7. Prompt and caching

The order is `tools` → `system` → `messages`. Caching works on an exact prefix, so:

- **Tools and system prompt: fixed text, in a fixed order.** No `new Date()`, no user name and
  no ids in them. These get cached, and cache reads cost about a tenth of normal input
  (Opus 5.5: $0.20/1M).
- **Everything that changes goes in the user message:** today's date, the snapshot and the
  message.
- Caching only starts once the cached prefix reaches a model-dependent minimum (512–4096 tokens).
  If `response.usage.cache_read_input_tokens` stays at 0, the tools and system prompt are too
  short to cache. That's fine; it just means no discount.

System prompt outline (`SYSTEM_PROMPT`):

- Role: keeps a university teacher's weekly routine, task plan and deadlines up to date from short,
  informal messages, often typed late at night with typos.
- How to read the snapshot: field meanings, the Sun–Thu academic week, times as 24-hour `HH:MM`,
  what `virtual` and `slotId` mean, and that the user's "today" is in the snapshot.
- Make changes only by calling the tools, and use ids exactly as given. When a message is
  ambiguous ("thursday class is taken" when there are two Thursday entries), ask a short question
  instead of guessing.
- Habits from the original chat, in brief:
  - "X is done" or "taken" → done.
  - "postponed" → cancelled, plus any tasks that depended on it become `dropped` with a reason
    (e.g. "Not needed — exam postponed").
  - "shifted to Thursday, same time, room 304" → `move_event`.
  - "no classes next week" → `cancel_week_classes`.
  - Keep the user's own names for courses.
- Keep the text reply short: say what changed and ask about anything left unclear. Don't
  repeat the whole schedule.

Snapshot (built on the client from the page's state, keeping it small):

```jsonc
{
	"today": "2026-10-10", // plus weekday
	"weeks": ["2026-10-04", "2026-10-11"],
	"schedule": [
		/* occurrences(...) for both weeks + undatedEvents(): id, date, start, end, title, kind, room, status, note, virtual */
	],
	"timetable": [/* slots: id, title, weekday, start, end, room */],
	"tasks": [
		/* open tasks, plus done ones from the shown weeks: id, text, date, until, start, end, status, note, highlight */
	],
	"deadlines": [/* id, text, due, label, hard, done, note */],
	"weekNotes": [/* week, text */]
}
```

---

## 8. Client side

1. **Pull the page's mutation helpers into a module.** Move `putEvent`, `moveEvent` handling,
   `weekOff`, `putTask` and the rest out of `src/routes/schedule/+page.svelte` into
   `src/lib/schedule-ops.ts`, as
   `applyOperations(state, operations, ids) → { state, writes, undo }`. Make it pure and
   unit-test it like `schedule.spec.ts`. The page buttons and the chat then share one code path.
2. **Chat UI:** a box at the top of the Schedule page (`print:hidden`), with a text input and a
   send button that shows a loading state while waiting.
3. **Preview:** list the proposed operations in plain words ("✓ Mark _SWE 0688-2237, Mon Oct 5_
   cancelled", "⇢ Move _DBMS lab_ Wed → Thu 9:00, room 304"). Give each one a checkbox, then
   Apply or Discard. Grey out any operation whose id isn't in the current state.
4. **Apply:** run `applyOperations`, save with the existing `db.ts` functions, and show one toast
   with "Undo" that reverts the whole batch.
5. **Plan panel (later):** the same box could sit on the day page's Plan panel for one-line
   updates.

---

## 9. Before shipping

- **Build a small test set from the original chat.** Its messages make good cases, each with the
  operations you'd expect. For example:
  - "Monday's SWE class is cancelled, Monday's invigilation is postponed to Tuesday 12:30"
  - "I don't have to grade the Excel exam now"
  - "DBMS evaluations 1 and 2 are done"
  - "you crossed out SWE questions, bring it back in"

  Run them against `claude-opus-5-5` and `claude-sonnet-5-5` and compare. Every run costs real
  money, so keep the set small (10–20 cases).

- Log `response.usage` (input, output and cache-read tokens) for the first week to check the cost.
- Rate-limit the route per uid (e.g. 30 messages an hour) with a Cloudflare rate-limiting rule or a
  KV counter.
- Never apply operations without the preview step. A wrong guess must be easy to reject.

---

## Checklist

- [ ] API key created, spend limit set, `wrangler secret put ANTHROPIC_API_KEY`, `.dev.vars` git-ignored
- [ ] `npm i @anthropic-ai/sdk jose`, `nodejs_compat` flag if needed, `app.d.ts` Platform env typed
- [ ] `src/lib/server/verify-firebase.ts` (+ uid allowlist)
- [ ] `src/lib/server/schedule-chat-tools.ts`: `SYSTEM_PROMPT` + strict `TOOLS`
- [ ] `src/routes/api/schedule-chat/+server.ts`
- [ ] `src/lib/schedule-ops.ts` + tests; Schedule page uses it for buttons too
- [ ] Chat box, preview, apply, undo toast
- [ ] Test set run on Opus 5.5 vs Sonnet 5.5; pick model; usage logging; rate limit
