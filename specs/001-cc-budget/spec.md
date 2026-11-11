# 001 cc-budget: weekly token budgets per project and subagent

Linear: PFB-158.

## Problem

Claude Code has only the plan's global usage limits. One project or one runaway subagent can
use up the allowance shared by all other work, and nothing says so until the plan limit hits.
A solo developer who runs several projects and background agents side by side wants each one
capped per week, the way a team gives each service a cost budget.

## Users

A developer on a Claude subscription who runs Claude Code in several project folders, often
with subagents and worktrees, and wants to stop one of them from eating the week.

## User stories

### US1 Project budget

As a developer, I set a weekly budget for a project, so that its sessions stop before they use
more than I planned.

Acceptance criteria:

- AC1.1 A budget is one number in a small config file that belongs to the project.
- AC1.2 Usage is the sum over the last 7 days (rolling) of every session in the project
  folder, its subagents, and its Claude Code worktrees.
- AC1.3 Tokens are cost-weighted: `input + 5 × output + 1.25 × cache writes + 0.1 × cache reads`.
- AC1.4 Each assistant message counts once, even though the transcript repeats it per block.
- AC1.5 A project without a config file has no budget: the mod does nothing there.

### US2 Warning at 80%

As a developer, I see a warning when a budget is at 80% or more, so that I can wind down or
raise it before work stops.

- AC2.1 At session start and when I submit a prompt, a project at ≥ 80% shows a one-line
  warning with used, budget and percent.
- AC2.2 The warning shows at most once per session per threshold (80%, 100%), not on every prompt.

### US3 Block at 100%

As a developer, I want tool calls blocked when a budget is used up, so that an agent cannot
keep spending unattended.

- AC3.1 At ≥ 100%, every tool call in the project is denied with a reason that names the
  budget, the usage, and how to continue.
- AC3.2 Prompts still go through, so I can talk to Claude and decide what to do.
- AC3.3 Raising the budget in the config file unblocks at the next tool call.
- AC3.4 Starting Claude Code with `CC_BUDGET_OVERRIDE=1` in the environment turns blocking off
  for that session; warnings stay.

### US4 Subagent budget

As a developer, I set a weekly budget per subagent type, so that one kind of agent (a reviewer,
an explorer) cannot run away inside a project that still has budget.

- AC4.1 The project config can list budgets by subagent type, for example `Explore` or `code-reviewer`.
- AC4.2 A subagent type's usage is the sum of that type's subagent transcripts in the project
  over the last 7 days. It also counts toward the project total.
- AC4.3 When a subagent type is at ≥ 100%, starting a new subagent of that type is denied, and
  tool calls made inside a running subagent of that type are denied.

### US5 See where I stand

As a developer, I can see a project's usage against its budgets without a hook firing.

- AC5.1 A command prints the project's usage, budget and percent, plus each subagent type with a budget.
- AC5.2 The same command has a one-line form for a status line.

### US6 Self-check

- AC6.1 A self-check builds sample transcripts in a temporary folder and verifies the tally,
  the warning, the block, the subagent rules and the override. It needs no live session.

### Non-functional

- NF1 A hook adds no noticeable delay: under 200 ms when nothing changed, by reading only new
  transcript bytes and caching totals.
- NF2 Fail open (constitution 4): bad config, unreadable transcripts or a crash never block.
- NF3 Plain Python 3 standard library; no install step.

## Out of scope

- Per-session or per-day budgets, and calendar weeks.
- Dollar amounts or exact plan-limit math; the weights are an approximation.
- A pane or dashboard; hq's Usage view is not rebuilt.
- Budgets for usage outside Claude Code transcripts on this machine (claude.ai, other devices).
- Bots that run in no project folder.

## Clarifications

- 2026-11-11 Metric: cost-weighted (AC1.3). Counting all four token kinds like hq did gives
  numbers dominated by cache reads (34M a week for one project).
- 2026-11-11 At 100%: block tool calls, allow override; prompts still go through (AC3.2, AC3.4).
- 2026-11-11 Scopes in v1: project and subagent type (US1, US4).
- 2026-11-11 Location: `plugins/cc-budget` in this marketplace repo, worked on `develop`.
- 2026-11-11 Config file: `<project>/.claude/cc-budget.json`, found by walking up from the
  session's folder. Committing or ignoring it is the project owner's choice.
- 2026-11-11 Sibling folders: the config takes an `include` list of extra folders (globs,
  relative to the project) whose sessions count toward the project. Claude Code worktrees
  (`.claude/worktrees/*`) always count.
- 2026-11-11 Status line: a plugin cannot set the status line, so AC5.2 is a command the user
  adds to their own status line script.
- 2026-11-11 Sample budget for the owner's first project: 15M per week including sibling
  folders, `Explore` 1M. Kept outside this repo (constitution 1).
