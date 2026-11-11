# Constitution

The rules every spec in this repo builds on. Repo conventions, checks and workflow live in
[CLAUDE.md](../CLAUDE.md) and [README.md](../README.md); they are not repeated here.

1. **Public repository.** No personal names, handles, paths or usage data in files, commits or
   examples. Examples use neutral paths such as `~/code/my-app`.
2. **One mod, one folder.** Each mod lives in `plugins/<mod>/` with its own `plugin.json`,
   `README.md` and `CHANGELOG.md`, and an entry in `.claude-plugin/marketplace.json`.
3. **No install step.** A mod works after `/plugin install`. No dependencies beyond what
   Claude Code or macOS/Linux ship with.
4. **Fail open.** A hook that errors, times out or cannot read its input never blocks the
   user's work. It stays silent or prints one line on stderr.
5. **Read, don't touch.** Mods never write into Claude Code's own files (transcripts,
   settings). They keep their state in the plugin data folder.
6. **Every mod has a self-check** that runs without a live session and passes before a commit.
