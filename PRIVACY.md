# Privacy statement: Terminal Pane

Applies to the Terminal Pane mod for Claude Code (`powermods-terminal`), published at https://github.com/netgfx/claude-terminal-mod.

## What it collects

Nothing. The mod runs your shell in a pane on your own machine. What you type and what the terminal shows stay in memory on your machine while the pane is open; they are not stored, logged or sent to Claude.

## Where it is stored

Nowhere. The mod writes no files and keeps no settings or history of its own. Its two npm dependencies are installed by Claude Code into the plugin's folder.

## What leaves your machine

- **registry.npmjs.org:** when you install or update the plugin, Claude Code downloads the two pinned npm packages the PTY host needs (`@lydell/node-pty` and `@xterm/headless`). npm's usual request data (such as your IP address) reaches the registry; no data from the mod is sent.
- **127.0.0.1:** the mod talks to its own PTY host over a local connection that never leaves your machine.

Commands you run in the shell can of course reach any host, as in any terminal; that is your own activity, not the mod's.

## Retention and deletion

Nothing is retained. Uninstalling the plugin (`/plugin uninstall powermods-terminal@claude-terminal-mod`) removes it and its installed dependencies.

## Sharing

No data is sold or shared with anyone.

## Children

The mod is a developer tool and is not directed at anyone under 18.

## Contact

Questions or concerns: https://github.com/netgfx/claude-terminal-mod/issues
