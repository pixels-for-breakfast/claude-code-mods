# Changelog

## 1.0.0

- Weekly token budgets per project in `.claude/cc-budget.json`, over a rolling 7 days of
  cost-weighted transcript usage, including worktrees and included folders.
- Budgets per subagent type.
- Warning at 80% at session start or on the next prompt, once per session.
- Tool calls denied at 100%; `CC_BUDGET_OVERRIDE=1` turns blocking off.
- `status`, `status --line` and `selfcheck` commands.
