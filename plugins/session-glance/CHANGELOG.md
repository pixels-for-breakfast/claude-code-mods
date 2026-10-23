# Changelog

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
