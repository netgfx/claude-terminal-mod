# claude-terminal-mod

A Claude Code mod that adds a real terminal (PTY) pane: `/trm` opens your shell in the workspace folder, with full-screen apps and colours.

## Install

This repo is a Claude Code plugin marketplace. Add it, then install the plugin:

```
/plugin marketplace add netgfx/claude-terminal-mod
/plugin install terminal-mod@claude-terminal-mod
```

Or from a shell:

```bash
claude plugin marketplace add netgfx/claude-terminal-mod
claude plugin install terminal-mod@claude-terminal-mod
```

## Usage

Run `/trm` to open the terminal pane.

## Requirements

- Node.js 18+ (for the PTY host). On first run the host runs a one-time `npm install` in `pty-host/`.

## Configuration

Set these in `/config` → terminal-mod:

- **Shell**: `pwsh`, `powershell`, `cmd`, `bash`, `zsh`, `fish` or a full path. Empty picks pwsh/powershell on Windows, your login shell on macOS.
- **Node.js**: path to `node`. Empty finds it on PATH.

## License

MIT
