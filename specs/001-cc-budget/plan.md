# 001 cc-budget: plan

## Approach

One Python 3 script (standard library only) behind three command hooks. It tallies the
project's transcripts on each hook call, reading only bytes added since the last call.

```
plugins/cc-budget/
  .claude-plugin/plugin.json     name, version, description
  hooks/hooks.json               SessionStart, UserPromptSubmit, PreToolUse -> cc_budget.py hook
  hooks/cc_budget.py             tally, hook logic, `status`, `selfcheck`
  README.md  CHANGELOG.md
.claude-plugin/marketplace.json  + cc-budget entry
README.md                        + row in the Mods table
```

## Config

`<project>/.claude/cc-budget.json`:

```json
{
  "week": 15000000,
  "include": ["../my-app-*"],
  "agents": { "Explore": 1000000, "code-reviewer": 500000 }
}
```

- `week`: weighted tokens per rolling 7 days for the whole project. Optional when only agents have budgets.
- `include`: optional globs, relative to the project folder.
- `agents`: optional, keyed by subagent type as Claude Code names it (`Explore`, `general-purpose`, `my-plugin:reviewer`).
- Found by walking up from the hook's `cwd`. The project folder is the parent of `.claude/`.
- Invalid JSON or wrong types: one stderr line, no budget (fail open).

## Tally

- Transcript folder name = absolute path with every character other than a letter or digit
  replaced by `-` (`/a/my.app` -> `-a-my-app`). Worktrees: `<name>--claude-worktrees-*`.
  Includes: the resolved glob encoded the same way, `*` kept, matched against
  `~/.claude/projects/`. Matching on folder names means deleted folders still count.
- Files: `<dir>/*.jsonl` and `<dir>/*/subagents/agent-*.jsonl`; a subagent's type comes from
  its `.meta.json` (`agentType`). Files not modified in 7 days are skipped.
- Lines: `type == "assistant"` with `message.usage`, `message.id`, `timestamp`. Weight =
  `input + 5*output + 1.25*cache_creation + 0.1*cache_read`. Model `<synthetic>` is skipped.
  Each message id counts once per file. A line without a trailing newline is left for later.
- Cache: `${CLAUDE_PLUGIN_DATA}/cache.json`, per file `{offset, agent, msgs: {id: [epoch, weight]}}`.
  Entries older than 7 days are pruned. Written to a temp file, then renamed, so parallel
  sessions never read half a file; a lost update only means bytes are read again.

## Hook behaviour

| Event | No config | < 80% | >= 80% | >= 100% |
|---|---|---|---|---|
| SessionStart, UserPromptSubmit | nothing | nothing | `systemMessage` + `additionalContext`, once per session per threshold | same, worded as blocked |
| PreToolUse | nothing | nothing | nothing | deny with reason (unless override) |

- Subagent: PreToolUse with `tool_name == "Agent"` is denied when `tool_input.subagent_type`
  is at >= 100% of its budget. Any PreToolUse whose input has `agent_type` over budget is denied.
- Override: `CC_BUDGET_OVERRIDE=1` in the environment skips every deny.
- Per-session notice state: `${CLAUDE_PLUGIN_DATA}/notified/<session_id>`.
- Any exception: exit 0, no output, one stderr line.

## Commands

- `python3 cc_budget.py status [folder]`: table of project and agent usage vs budget.
- `python3 cc_budget.py status --line`: reads the status line JSON on stdin (`cwd`), prints
  e.g. `budget 62% (9.3M/15M)`, or nothing without a config.
- `python3 cc_budget.py selfcheck`: temp projects folder with synthetic transcripts
  (duplicated blocks, a partial last line, an old message, a subagent with meta, a worktree,
  an include) and asserts every acceptance criterion it can reach. Env vars
  `CC_BUDGET_PROJECTS` and `CC_BUDGET_DATA` point the script at the temp folders.
- README shows a two-line status line snippet that finds the installed script by glob.

## Risks

- Transcript format changes (field names): tally drops to zero and the mod goes quiet. The
  self-check pins the format; README names the fields.
- `systemMessage` display on SessionStart/UserPromptSubmit is not confirmed by the docs;
  `additionalContext` is sent too, and live testing settles it.
- Speed on large transcript folders: first run reads up to 7 days of files (tens of MB);
  later calls stat files and read new bytes only. Measured in validation (NF1).
- Weights are an approximation of plan usage, stated in the README.

## Alternatives rejected

- Reusing hq's SQLite tables: hq is being retired.
- A TypeScript hooks module like session-glance: needs atoms and the engine for no gain; a
  command hook is the plain, portable form.
- Blocking in SubagentStart: the docs say it cannot block.
- One central config: the owner chose per-project files.
