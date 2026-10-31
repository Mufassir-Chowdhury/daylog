# Assistant — decisions and preferences

These are the owner's choices. They override anything in the plan or research notes. Change this
file when a decision changes, and say so in [`progress.md`](./progress.md).

Part of the assistant docs: [plan](../../assistant.md) · [research](./research.md) ·
[progress](./progress.md).

## Decisions

| Topic                 | Decision                                                                                                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persona               | It should **feel like JARVIS from Iron Man** (see "Persona" below). Decided 2026-10-30.                                                                                                                                                                                                      |
| Name                  | A **name you can change** in Settings, used everywhere it speaks (drawer title, bubbles, cards, notifications). **Default: `Jarvis`.** How it addresses you is also a setting (default: your first name).                                                                                    |
| Provider              | **Switchable** between Claude and Gemini, **bring your own key** per device. One provider active at a time, with a _chat model_ and a _background model_. Key never synced to Firestore.                                                                                                     |
| Data sent to provider | Everything, **including Finance and Activity**. The per-area switches still exist in Settings, but all start **on**. (Window titles in Activity are included too, since the owner allowed Activity.)                                                                                         |
| Small additions       | **Applied automatically**, then shown in a **toast/bubble** that says what the assistant did, with **Undo**. "Small additions" = adding things, never changing or removing them: `append_line`, `add_task`, `create_note`, `append_to_note`, `add_subtask`, `log_routine_value`, `remember`. |
| Bigger changes        | Moving, cancelling, editing existing items and all money records stay as **proposal cards** (Apply / Edit / Dismiss, plus "Always allow this kind"). No deletes at all.                                                                                                                      |
| Scheduled check-ins   | **08:00 morning warm-up**, **17:00 brief**, **23:15 brief**, plus a **weekly review on Thursday 20:00** (added in 6.5 from the plan's weekly review). All times (and whether each is on) are **editable in Settings**, and more check-ins can be added there.                                |
| Where background runs | **Desktop and web.** Whichever device is open holds the Firestore lease and runs the check-ins; the desktop app is preferred when it's running because it's always on. A web tab (including on a phone) runs them when no desktop app is.                                                    |
| Voice mode            | **ElevenLabs** for speech-to-text and text-to-speech, **on only when an ElevenLabs key is saved** on the device (off otherwise). It should sound like a friendly JARVIS: a calm British voice, composed and warm. Built 2026-10-31 (see progress.md).                                        |
| Build order           | Follow the plan's steps in order. Steps 0–6 done.                                                                                                                                                                                                                                            |

### Persona: JARVIS

The owner wants it to feel like JARVIS. For prompts (Step 2) and every line it writes:

- **Composed and capable.** Calm, precise, quietly confident. Never gushing, never "Great question!".
- **Anticipates.** Leads with what matters now and what it has already handled; suggests the next
  move before being asked.
- **Brief.** A sentence or two unless asked for more. Briefs read like a status report, not an essay.
- **Dry wit, used sparingly.** A light touch, never at the expense of clarity, never in bad news.
- **Addresses you** by the "Calls you" setting (your first name by default) — at most once per
  message, usually at the start ("Good morning, Mufassir.").
- **Reports what it did** in past tense ("Added _Grade DM_ to Later."), and asks only when it
  genuinely can't decide.
- It's an original assistant in that spirit — no quotes or catchphrases from the films.

### What each check-in covers

- **08:00 morning warm-up** — _what's up for the day_: today's classes and rooms, tasks with
  time blocks, deadlines within a week, anything carried over from yesterday (offer to move it
  here), and the best focus window.
- **17:00 brief** — the rest of today (what's still open, what's coming tonight), tomorrow's first
  classes and anything due tomorrow, and spending pace if it's off.
- **23:15 brief** — end of day: what got done, what's left (offer to move it to tomorrow / Later /
  drop), routines and money mentioned but not logged, streaks at risk, and the first thing on
  tomorrow.

## Still open

- Quiet hours (default set: 00:00–07:30, no notifications; the Inbox still fills). Editable.
- Daily caps (default set: at most 5 unprompted cards a day outside the scheduled check-ins, at most
  1 focus nudge an hour). Editable.
