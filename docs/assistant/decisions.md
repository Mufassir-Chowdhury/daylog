# Assistant — decisions and preferences

These are the owner's choices. They override anything in the plan or research notes. Change this
file when a decision changes, and say so in [`progress.md`](./progress.md).

Part of the assistant docs: [plan](../../assistant.md) · [research](./research.md) ·
[progress](./progress.md).

## Decided 2026-10-30

| Topic                 | Decision                                                                                                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                  | The assistant has a **name you can change** in Settings. Use it everywhere (drawer title, bubbles, cards, notifications). Default name: `Assistant` until the owner picks one.                                                                                                               |
| Provider              | **Switchable** between Claude and Gemini, **bring your own key** per device. One provider active at a time, with a _chat model_ and a _background model_. Key never synced to Firestore.                                                                                                     |
| Data sent to provider | Everything, **including Finance and Activity**. The per-area switches still exist in Settings, but all start **on**. (Window titles in Activity are included too, since the owner allowed Activity.)                                                                                         |
| Small additions       | **Applied automatically**, then shown in a **toast/bubble** that says what the assistant did, with **Undo**. "Small additions" = adding things, never changing or removing them: `append_line`, `add_task`, `create_note`, `append_to_note`, `add_subtask`, `log_routine_value`, `remember`. |
| Bigger changes        | Moving, cancelling, editing existing items and all money records stay as **proposal cards** (Apply / Edit / Dismiss, plus "Always allow this kind"). No deletes at all.                                                                                                                      |
| Scheduled check-ins   | **08:00 daily wrap-up**, **17:00 brief**, **23:15 brief**. All three times (and whether each is on) are **editable in Settings**, and more check-ins can be added there.                                                                                                                     |
| Where background runs | **Desktop and web.** Whichever device is open holds the Firestore lease and runs the check-ins; the desktop app is preferred when it's running because it's always on. A web tab (including on a phone) runs them when no desktop app is.                                                    |
| Voice mode (future)   | Plan for **ElevenLabs** (speech-to-text and text-to-speech) when voice mode is added. Not in the current build order; see the plan's "Future: voice mode" section.                                                                                                                           |
| Build order           | Start with **Step 0 (ops layer)**, then follow the plan's phases in order.                                                                                                                                                                                                                   |

### What each check-in covers

The owner gave the times; the content below is the working interpretation. Adjust here if it's
wrong.

- **08:00 daily wrap-up** — closes out _yesterday_ and sets up _today_: unfinished lines and tasks
  from yesterday (offer to carry them over), routines and money mentioned but not logged,
  then today's classes, tasks and deadlines due within a week.
- **17:00 brief** — the rest of today (what's still open, what's coming tonight), tomorrow's first
  classes and anything due tomorrow, and spending pace if it's off.
- **23:15 brief** — end of day: what got done, what's left (offer to move it to tomorrow / Later /
  drop), routine streaks at risk, and the first thing on tomorrow.

## Still open

- The assistant's actual name (the default stays `Assistant`).
- Quiet hours (default proposal: 00:00–07:30, no notifications; the Inbox still fills).
- Daily caps (default proposal: at most 5 unprompted cards a day outside the scheduled check-ins,
  at most 1 focus nudge an hour).
