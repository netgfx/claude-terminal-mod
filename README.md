# Terminal Pane

A Claude Code mod (`powermods-terminal`) that adds a real terminal (PTY) pane: `/trm` opens your shell in the workspace folder, with full-screen apps and colours.

> **Claude Code only.** Runs in the Claude Code CLI (v2.1.287+), the Desktop app's Code tab (v2.1.286+) and the VS Code extension (v2.1.299+ for panes). It does nothing in claude.ai chat or Cowork. The terminal itself draws in the Claude Code terminal and the Desktop app; the VS Code extension shows a note instead.

What it runs, installs and connects to is listed under [Data, network and permissions](#data-network-and-permissions). Privacy statement: [PRIVACY.md](PRIVACY.md).

## Install

This repo is a Claude Code plugin marketplace. Add it, then install the plugin:

```
/plugin marketplace add netgfx/claude-terminal-mod
/plugin install powermods-terminal@claude-terminal-mod
```

Or from a shell:

```bash
claude plugin marketplace add netgfx/claude-terminal-mod
claude plugin install powermods-terminal@claude-terminal-mod
```

The plugin was called `terminal-mod` before version 0.3.0. The marketplace maps the old name to the new one, so an existing install moves over when you update it. It keeps no data, so nothing is lost.

To work on it from a checkout, install its two dependencies once, then load the folder:

```bash
npm ci --omit=dev --ignore-scripts
claude --plugin-dir /path/to/claude-terminal-mod
```

## Usage

Run `/trm` to open the terminal pane. Click it to type; Esc hands the keys back to Claude. Shift+PageUp and Shift+PageDown scroll the scrollback. Closing the pane ends the shell.

## Requirements

- **Node.js 18+** on your machine, to run the PTY host.
- **A platform with a prebuilt PTY binary:** Windows (x64, arm64; Windows 10 1809 or later for ConPTY), macOS (Intel and Apple silicon) and Linux (x64, arm64, glibc). These are the binaries `@lydell/node-pty` 1.1.0 publishes; on any other platform the pane shows an error instead of a shell.

## Configuration

Set these in the plugin's settings (`userConfig`):

- **Shell** (`shell`): `pwsh`, `powershell`, `cmd`, `bash`, `zsh`, `fish` or a full path. Empty picks pwsh/powershell on Windows, your login shell on macOS and Linux.
- **Node.js** (`node`): path to `node`. Empty: the mod looks for `node` where your terminal would find it (on macOS and Linux, by asking your login shell).

## Data, network and permissions

### At a glance

- **Programs it runs:** a terminal is the mod's purpose, so it starts your shell, through a small Node.js program of its own. Each is one named program with its arguments as a list:
  - `node <plugin>/pty-host/host.mjs <settings as JSON>`: the PTY host, a separate Node.js program in this plugin that runs your shell in a pseudo-terminal. It is not part of the hooks module, and as a Node program it uses Node's own `process` object (its arguments, environment, standard output and exit), which the hooks module never touches.
  - Your shell inside that terminal: the `shell` setting, else `pwsh` or `powershell` (Windows) or your login shell with `-l` (macOS, Linux). What you type there is yours to run.
  - To find those when they aren't set: `pwsh -NoLogo -NoProfile -Command "exit 0"` (Windows, to see whether PowerShell 7 is installed); `<login shell> -l -c "which -a node"` and `<node> --version` (macOS, Linux, to find a working Node.js the way your terminal would); `where.exe <shell>` inside the host (Windows, to find the shell's `.exe`).
  - It runs no downloader, and never runs text from the network, a model or the conversation as a command.
- **What it sends and where:** keys you type and the pane's size go from the mod to its own PTY host on `127.0.0.1`; the screen comes back over the host's standard output. Nothing goes to Claude, a model or any other host. The settings JSON it passes to the host holds only the shell, its arguments, the working folder and the pane's size.
- **Hosts it contacts:** `127.0.0.1` only, on the random port the PTY host picks at each start (`http://127.0.0.1:<port>/in`, `/resize`, `/ping`, `/kill`, each with the host's random token). The address can't be fixed text because the port is chosen at start. `registry.npmjs.org` is reached by Claude Code, not by the mod, when it installs the plugin's dependencies (below).
- **Dependencies it installs:** none itself. `package.json` and `package-lock.json` at the plugin root pin `@lydell/node-pty` 1.1.0 and `@xterm/headless` 6.0.0, and Claude Code installs them from that lockfile when it installs or updates the plugin, with no install scripts run. See [Dependencies and hosts](#dependencies-and-hosts).
- **Tools it calls itself:** none.
- **Slash commands it runs:** none. It adds `/trm`, and its `command.run` hook answers only `/trm`.
- **Permission decisions:** none. It has no permission hook. The shell you open runs outside Claude Code's permission rules, as any terminal does (below).
- **Files it writes:** none. It writes no build, start-up, settings or instructions file.
- **Environment variables / config it sets:** none in Claude Code. It reads the `OS` and `SHELL` variables. The shell it starts gets Claude Code's environment with the terminal variables listed below.
- **What it puts in prompts:** it submits no prompts. `/trm` prints one line, "Terminal opened. Click it to type; Esc hands the keys back to Claude.", which Claude can read.
- **What it gives the agents it starts:** it starts no agents.
- **Hooks:** it hooks no network, MCP or program call (`http.fetch`, `mcp.*`, `process.run`, `process.spawn`); it only makes its own.
  - `session.start`: registers `/trm`. Changes nothing.
  - `command.run` for `/trm` only: opens the pane.
  - `ui.message` for its own pane only: the keys and size the terminal view sends; starts the host on first use.
  - `ui.render` for its own pane only: draws the terminal.
  - `ui.close`: ends the shell when its pane closes. Passes the event on.

### How it works

```
Claude Code ── the mod (hooks/register.tsx)
                 │  starts: node pty-host/host.mjs '{"shell", "args", "cwd", "cols", "rows"}'
                 ▼
               PTY host (pty-host/host.mjs, a separate Node.js process)
                 │  runs your shell in a pseudo-terminal (ConPTY on Windows, forkpty elsewhere)
                 │  keeps the screen in a headless xterm, sends it to the mod on stdout
                 │  takes keys and size over HTTP on 127.0.0.1:<random port>, with a random token
                 ▼
               your shell, in the workspace folder
```

- The mod starts the host with `$.process.spawn` when the pane first draws, and stops it when you close the pane.
- The host listens on **127.0.0.1 only**, on a random free port, and answers only requests that carry its token: 24 random bytes, made fresh each time the host starts and known only to the mod. Anything else gets `403`.
- The mod reaches the host with `$.http.fetch` to `http://127.0.0.1:<port>`: `/in` (the keys you type), `/resize`, `/ping` every 10 seconds, and `/kill`. If the pings stop for 45 seconds (the mod reloaded or Claude Code exited), the host ends the shell and exits.

### The shell runs with your permissions, outside Claude Code

- The shell is yours, as in any terminal window. It runs with your user account's full permissions, **outside Claude Code's sandbox**, and the commands you type in it **are not checked by Claude Code's permission rules** or hooks. Claude doesn't see what you type or what the terminal shows.
- Its environment is Claude Code's environment, with `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=terminal-mod` set, and `NO_COLOR`, `CLICOLOR`, `PAGER`, `GIT_PAGER` and `CLAUDECODE` removed.

### Dependencies and hosts

- The PTY host needs two npm packages, pinned to exact versions in `package.json` and `package-lock.json` at the plugin root: `@lydell/node-pty` 1.1.0 (with its prebuilt binary for your platform) and `@xterm/headless` 6.0.0.
- **Claude Code** downloads them from **registry.npmjs.org** when it installs or updates the plugin, from that lockfile only, with no install scripts run, into the plugin's own folder (`node_modules` next to `package.json`). The mod and the host never download or install anything; when the packages are missing, the pane says how to install them.
- Hosts: `127.0.0.1` (the PTY host on your own machine) and `registry.npmjs.org` (the one-time dependency download by Claude Code). Nothing else.

### Programs it starts

- The PTY host: `node <plugin>/pty-host/host.mjs <spec>`, where `node` is your `node` setting or the first `node` your terminal would find.
- Your shell, inside the PTY: the `shell` setting, or `pwsh`/`powershell` on Windows (the host resolves it with `where.exe`), or your login shell (the one your account is set to use, else `/bin/sh`) with `-l` on macOS and Linux.
- To pick those when they aren't set: on Windows, `pwsh -NoLogo -NoProfile -Command "exit 0"` to see whether PowerShell 7 is there; on macOS and Linux, `<login shell> -l -c "which -a node"` and `<node> --version` for each result.

### What it reads and stores

- It reads the `OS` and `SHELL` environment variables and the session's working directory.
- It writes no files, keeps nothing in `$.store`, calls no model, and doesn't observe or change Claude's tool calls or prompts. The screen lives in memory while the pane is open.

### Uninstall

`/plugin uninstall powermods-terminal@claude-terminal-mod` removes the plugin and the `node_modules` Claude Code installed with it. For a checkout loaded with `--plugin-dir`, delete the `node_modules` folder you installed there.

## Develop

```
claude plugin validate .
claude plugin test .
```

## License

MIT
