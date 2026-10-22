# Claude Code mods by Pixels for Breakfast

A [Claude Code](https://claude.com/claude-code) plugin marketplace with mods by [Pixels for Breakfast](https://pixelsforbreakfast.nl).

## Mods

| Mod | What it does |
| --- | --- |
| [session-glance](plugins/session-glance) | A pane beside the chat with a rolling status of the session (goal, done-when criteria, done, next, drift) and a checklist that fills itself from the agent's tasks; copies both as markdown |

Each mod's own README covers its commands, settings, and what it sends to the model.

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

## Bugs and ideas

Open an [issue](https://github.com/pixels-for-breakfast/claude-code-mods/issues/new/choose): the bug report asks for the mod and Claude Code versions and where you saw it; the feature request is for ideas for a mod, or for a new one.

## Licence

MIT, see [LICENSE](LICENSE).
