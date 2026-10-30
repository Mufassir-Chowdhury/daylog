# Assistant — evaluation cases

Messages the assistant should handle, with the tool calls a correct answer makes. Step 7 turns
these into a runnable eval (`npm run eval:ai`, run by hand against both providers — every run
costs money). Until then, use them for a manual check after changing the prompt or tools.

Part of the assistant docs: [plan](../../assistant.md) · [decisions](./decisions.md) ·
[progress](./progress.md).

Setup for the schedule cases: a timetable with SWE (Mon), DBMS lab (Wed), ICA (Sun), an Excel exam
with a grading task, invigilation on Monday, and DBMS evaluations 1 and 2 as tasks.

| #   | Message                                                                                | Expected                                                                                                      | Applied how   |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | "Monday's SWE class is cancelled, Monday's invigilation is postponed to Tuesday 12:30" | `schedule_snapshot`; `set_event_status` (SWE Mon → cancelled); `move_event` (invigilation → Tue, start 12:30) | two cards     |
| 2   | "I don't have to grade the Excel exam now"                                             | `set_task_status` (grading task → dropped, note like "Not needed")                                            | card          |
| 3   | "DBMS evaluations 1 and 2 are done"                                                    | two `set_task_status` → done                                                                                  | two cards     |
| 4   | "the Wednesday lab is shifted to Thursday, same time, room 304"                        | `move_event` (lab → Thu, same start/end, room 304)                                                            | card          |
| 5   | "no classes next week"                                                                 | `cancel_week_classes` (any day of next week)                                                                  | card          |
| 6   | "thursday class is taken" (two Thursday entries)                                       | asks which one — no tool call that changes anything                                                           | —             |
| 7   | "add grading DM to later"                                                              | `add_task` (date null)                                                                                        | at once, Undo |
| 8   | "remind me to call mom at 9 tonight"                                                   | `append_line` (today, `21:00 call @mom` or similar)                                                           | at once, Undo |
| 9   | "spent 250 on lunch" (one account)                                                     | `add_transaction` (expense, 250, lunch)                                                                       | card          |
| 10  | "spent 250 on lunch" (two accounts)                                                    | asks which account, or the tool's error leads it to ask                                                       | —             |
| 11  | "gave rahim 500"                                                                       | `add_transaction` (lend, 500, person rahim)                                                                   | card          |
| 12  | "read 12 pages today"                                                                  | `log_routine_value` (the reading routine, 12)                                                                 | at once, Undo |
| 13  | "move yesterday's unfinished stuff to today"                                           | `open_lines` (before today, 1 day); one `move_line` per open line                                             | cards         |
| 14  | "what's up today?"                                                                     | `read_day` (today) and `schedule_snapshot`; no changes                                                        | —             |
| 15  | (after dismissing #2's card) "ok"                                                      | doesn't propose #2 again                                                                                      | —             |

Grading: the right tools with the right ids and fields (exact), plus a short reply that says what
happened. Replies are judged by reading, not string matching.
