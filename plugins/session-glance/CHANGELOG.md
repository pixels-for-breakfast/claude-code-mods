# Changelog

## 1.0.11

- `/glance demo` shows all three earlier turns under **Earlier (3)**. Its history now ends with the turn the Done line describes, as a real session's does; before, the newest earlier turn was taken for the Done line and left out.

## 1.0.10

- The drop line in Edit mode no longer ends in a stray "…" on the desktop: its strokes wrap to a second line the one-row layer clips, instead of being cut with an ellipsis.

## 1.0.9

- An attempt to end the drop line in Edit mode without a stray "…" (`wrap="truncate"`); the desktop still drew it. Fixed in 1.0.10.

## 1.0.8

- The carry-over offer leaves out to-dos your card already holds, the same one or one worded the same. It offered "Write the README" next to the demo's own copy, and bringing it added nothing.

## 1.0.7

- The Settings card shows which model is in use: it is drawn as the primary button, the other one dimmed. On the desktop both looked the same.

## 1.0.6

- Edit mode on the desktop draws its rows closer together: two cells a row instead of three, near the pitch of the rows outside Edit mode.

## 1.0.5

- Suggestions stand out: a box framed in the accent, a ✦ label, the suggestion in medium weight, the main button drawn as the surface's primary button and Dismiss quieter beside it.
- The buttons say where a suggestion goes: **Add as to-do** for your next step, **Use as title** for a title suggestion.

## 1.0.4

- `/glance demo` also shows a title suggestion, so the demo covers every state the Status card can show.

## 1.0.3

- A listing icon (`.claude-plugin/icon.png`): the pane beside the chat, with its checkboxes in each state.

## 1.0.2

- The Agent tasks card follows the desktop app's own task list too. In the app's Code tab the agent plans with `update_plan` instead of `TaskCreate` or `TodoWrite`, so the card stayed empty there. A new list replaces the plan's steps; `advance`, `done` and `start` move them on. The person's own to-dos stay as they are.

## 1.0.1

- A resumed session gets its pane back straight away. In the terminal a resumed session starts under a passing id and takes its own a moment later; the mod only looked again at the next prompt, so the pane stayed empty until then. The id is now checked on the same 400 ms timer as the selection.
- An empty pane is no longer saved under such a passing id.

## 1.0.0

- The cost line moves from under the cards into the Settings card's header, so the pane ends with the cards.
- First stable release: everything below, documented in the README.

## 0.8.0

- **Earlier (n)** in the Status card: what each earlier turn did, newest first, saved with the pane.

## 0.7.0

- **● your move** in the band between turns: the next step that is yours, or "answer the question" when the answer ends on one.

## 0.6.0

- A new session offers the open to-dos the last session in the same project left, to bring along or dismiss.

## 0.5.2

- One settings table for the Settings card, the commands and the defaults; one snapshot reset for restore, purge and the demo; a shared suggestion box; the tool hook type-checks.

## 0.5.1

- `register.tsx` split into modules (state and events stay; view, status, prompts, tree, icons, settings and demo move out). No change in behaviour.

## 0.5.0

- Archive tasks in Edit mode, with an **Archived (n)** fold and Restore.
- A **Settings** card for every setting and the model.
- Edit mode per card, one-click row buttons, and the help behind an info mark.

## 0.4.0

- **+ Task** and **+ To-do** beside the status toggle while text is selected, and `/glance task` / `/glance todo`.

## 0.3.0

- Separate cards for the agent's tasks and your own to-dos, with suggested next steps.

## 0.2.0

- The pane survives `/resume`, a restart and compaction.
- Done-when criteria you can tick, and an off-goal line.
- `/glance copy` as a markdown handoff.
- Settings for automatic updates, the task check and the model, and a count of the mod's own tokens.
- Title suggestions when the work moves on.

## 0.1.0

- The pane: a rolling status (goal, done when, done, next) and a checklist that follows the agent's task tools, with subtasks and Edit mode.
