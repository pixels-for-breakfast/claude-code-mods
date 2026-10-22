# Claude Code mods by Pixels for Breakfast

A [Claude Code](https://claude.com/claude-code) plugin marketplace with mods by [Pixels for Breakfast](https://pixelsforbreakfast.nl).

## Mods

| Mod | What it does |
| --- | --- |
| [session-glance](plugins/session-glance) | A sidebar pane with a rolling summary of the session (goal, done when, done, next) and a checklist of its tasks |

## Install

At the prompt of a terminal session:

```
/plugin install session-glance --marketplace pixels-for-breakfast/claude-code-mods
```

From a shell:

```bash
claude plugin install session-glance --marketplace pixels-for-breakfast/claude-code-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `pixels-for-breakfast/claude-code-mods`, then Add plugin.

## Repository layout

```
.claude-plugin/marketplace.json   the marketplace: lists every mod
plugins/<mod>/                    one folder per mod
  .claude-plugin/plugin.json      name, version, description
  hooks/                          the hooks module
  types/                          the mod's state contract
  tests/
```

To add a mod, create `plugins/<mod>/` and add an entry to `.claude-plugin/marketplace.json`.

## Developing

Run a mod from its folder:

```bash
claude --plugin-dir plugins/<mod>
```

Check and test it:

```bash
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```

## Licence

MIT, see [LICENSE](LICENSE).
