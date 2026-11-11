# cc-budget

Weekly token budgets per project and per subagent type for Claude Code.

Claude Code only has your plan's global usage limits. One busy project, or one runaway
subagent, can use up the allowance all your other work shares. cc-budget gives each project a
weekly budget: it warns at 80% and blocks tool calls at 100%.

## Install

```
/plugin install cc-budget --marketplace pixels-for-breakfast/claude-code-mods
```

## Set a budget

Create `.claude/cc-budget.json` in the project folder:

```json
{
  "week": 15000000,
  "include": ["../my-app-*"],
  "agents": { "Explore": 1000000, "code-reviewer": 500000 }
}
```

| Key | Meaning |
| --- | --- |
| `week` | Budget for the whole project, in weighted tokens per rolling 7 days. Optional when only `agents` have budgets. |
| `include` | Optional. Globs for extra folders, relative to the project folder, whose sessions count toward this project. |
| `agents` | Optional. Budgets per subagent type, as Claude Code names it: `Explore`, `general-purpose`, `my-plugin:reviewer`. Subagent usage also counts toward `week`. |

The budget applies to sessions started in the project folder or any folder below it, and to
Claude Code worktrees of the project (`.claude/worktrees/*`). A project without the file has no
budget. Whether you commit the file is up to you.

To find a fitting number, set a large budget and run `status` (below) to see last week's usage.

## What counts

Usage comes from the Claude Code transcripts in `~/.claude/projects` over the last 7 days.
Each assistant message is weighted roughly by what it costs:

```
input + 5 × output + 1.25 × cache writes + 0.1 × cache reads
```

Cache reads are cheap but plentiful, so counting all tokens equally would make every budget
huge. The weights approximate API pricing; they are not your plan's exact limit math.
Usage outside Claude Code on this machine (claude.ai, other devices) is not counted.

## What happens

| Usage | Effect |
| --- | --- |
| below 80% | nothing |
| 80% or more | a one-line warning at session start or with your next prompt, once per session |
| 100% or more | every tool call in the project is denied, with a reason Claude can read; your prompts still go through |

A subagent type over its budget cannot be started, and tool calls inside a running subagent of
that type are denied. The rest of the project keeps working.

To continue: raise the budget in the file (it applies at the next tool call), or start Claude
Code with `CC_BUDGET_OVERRIDE=1` in the environment to turn blocking off for that session.

If the config is invalid or something breaks, the mod stays out of the way: it never blocks
because of its own error.

## Check usage

```bash
python3 ~/.claude/plugins/cache/pixelsforbreakfast/cc-budget/*/hooks/cc_budget.py status ~/code/my-app
```

### In your status line

A plugin cannot set the status line, so add it to your own status line script. The command
reads the status line JSON on stdin and prints e.g. `budget 62% (9.3M/15M)`, or nothing in a
project without a budget:

```bash
input=$(cat)
script=$(ls -d ~/.claude/plugins/cache/*/cc-budget/*/hooks/cc_budget.py 2>/dev/null | tail -1)
[ -n "$script" ] && echo "$input" | python3 -I "$script" status --line
```

## Self-check

```bash
python3 plugins/cc-budget/hooks/cc_budget.py selfcheck
```

Builds sample transcripts in a temporary folder and checks the tally, the warnings, the
blocks, subagent budgets, the override and failing open.

## Privacy

Everything stays on your machine. The mod reads transcripts and keeps a cache of message ids,
times and weights in the plugin data folder (`~/.claude/plugins/data/`). It sends nothing to
the model except its warnings and block reasons.

## Requirements

Python 3.9 or later as `python3` (ships with macOS's command line tools).
