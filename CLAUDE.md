# claude-mods

A public Claude Code plugin marketplace ("pixelsforbreakfast", GitHub `pixels-for-breakfast/claude-code-mods`). Each mod is a folder in `plugins/` with an entry in `.claude-plugin/marketplace.json`. The only mod so far is `plugins/session-glance`; read its README.md and CHANGELOG.md before changing it.

## Public repository

- Never put the owner's personal first name or personal handle in commits, branch names, files or Linear text. Use "Pixels for Breakfast".
- Commits are authored as `Pixels for Breakfast <info@pixelsforbreakfast.nl>` (repo-local git config, already set).
- No AI attribution trailer or "generated with" footer in commits.

## session-glance code layout

- `hooks/register.tsx` holds all state (atoms), the actions and the events.
- Pure modules, no atoms: `hooks/pane.tsx` (view drawn from a `PaneView`/`BandView` plus actions), `status.ts`, `prompts.ts`, `tree.ts`, `icons.ts`, `settings.ts` (one `SWITCHES` table), `demo.ts`, `task-list.tsx` (the Edit-mode drag layer: drag and select only; row buttons sit beside it).
- `types/index.d.ts` is the state contract.

Hard constraint from the engine's static scan:

- An atom is read and written only in the file that defines it. Importing an atom from another file makes the module fail to load.
- One literal atom per `update`/`read` call. No `cond ? atomA : atomB`; branch around two calls instead.

## Checks before every commit

All must pass, run from the repo root:

```bash
claude plugin validate .
claude plugin validate plugins/session-glance
claude plugin test plugins/session-glance
cd plugins/session-glance && deno run -A npm:typescript@5.6.3/tsc -p . --noEmit
```

- Validate should report no warnings.
- `hooks/` and `types/` must type-check clean. A few "type instantiation too deep" errors in `tests/` are known.

## Workflow

- Small steps: one change or feature per commit.
- Per mod change: bump the version in `plugins/<mod>/.claude-plugin/plugin.json`, add a `CHANGELOG.md` entry, tag `<mod>-v<version>` (e.g. `session-glance-v1.0.3`).
- Work on a branch named `pfb-<issue>-<slug>` (no personal prefix from Linear), then fast-forward `develop` when done. `develop` is the main branch.
- A local hook blocks `git push`. Commit and tag, then hand over the push command: `git -C ~/claude-mods push --follow-tags`.
- Changes are tested live with `/reload-plugins`; the local marketplace reads this folder as it is on disk.

## Linear

- Team PFB, project "Claude Code mods".
- One issue per feature, with what was built and the commit. Set the status by hand; there are no PRs.
- The blog post about session-glance is PFB-31 in the "Pixels for Breakfast Blog Series" project and lives in `~/Herd/pixelsforbreakfast`. Don't edit that repo from here.
