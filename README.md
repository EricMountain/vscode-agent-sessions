# Agent Sessions

Manage independent terminal sessions running interactive coding agents
(Claude Code and others) from a dedicated view in VS Code — sessions survive
window reloads, and even quitting VS Code entirely, by living in a
persistent [tmux](https://github.com/tmux/tmux) server outside the editor.

## Why

Long-running coding-agent sessions (Claude Code, etc.) don't like being tied
to VS Code's own terminal lifecycle: a window reload or an accidental
restart kills the process and loses your in-progress conversation. Agent
Sessions launches each agent inside an isolated tmux server instead, and the
extension host is just a disposable viewer onto it — reload the window as
often as you like, the agents keep running and reattach automatically.

## Features

- **New Agent Session** — launch one or more configured agent CLIs (default:
  `claude`, i.e. Claude Code), each in its own tmux session.
- **Persistent across reloads** — sessions live in a tmux server independent
  of the extension host; the previously active session reattaches
  automatically on activation.
- **Live session list** — a tree view in the Activity Bar showing every
  running session, labeled from the agent's own terminal title, with exit
  detection and one-click kill.
- **Integrated terminal panel** — a reused webview tab (via `xterm.js`)
  renders the active session's live output and forwards your input/resize
  back to tmux.
- **Configurable agents** — point `agentSessions.agents` at any CLI, with
  custom args, working directory, and environment variables.

## Requirements

- macOS or Linux (Windows is out of scope — tmux isn't available there).
- [tmux](https://github.com/tmux/tmux) reachable on `PATH` (or point
  `agentSessions.tmuxPath` at it). The extension checks `tmux -V` on
  activation and disables "New Agent Session" with an error if it's missing.
- At least one agent CLI installed and on `PATH` — defaults to `claude`
  (Claude Code).

## Getting started

1. Install the extension and make sure `tmux` is on `PATH`.
2. Open the **Agent Sessions** icon in the Activity Bar.
3. Click **New Agent Session** (or run `Agent Sessions: New Agent Session`
   from the Command Palette). If more than one agent is configured, you'll
   be prompted to pick one.
4. The session opens in the terminal panel and appears in the list. Switch
   between sessions by selecting them in the tree; kill one with the trash
   icon, or all of them via `Agent Sessions: Kill All Agent Sessions`.

Sessions keep running in their tmux server even if you close the panel,
reload the window, or quit VS Code — reopen the workspace and they're still
there.

## Configuration

All settings live under `agentSessions.*` (Settings UI → search "Agent
Sessions", or edit `settings.json` directly):

| Setting | Default | Notes |
|---|---|---|
| `agentSessions.agents` | `[{ id: "claude-code", label: "Claude Code", command: "claude" }]` | Array of `{ id, label, command, args?, icon?, cwd?, env? }`. More than one entry adds a QuickPick to "New Agent Session". |
| `agentSessions.followTerminalTitle` | `true` | Derive the session label from the agent's own terminal title (OSC 0/2) instead of a static `"<label> N"` name. |
| `agentSessions.confirmKill` | `false` | Ask before killing a single session. `Kill All Agent Sessions` always confirms via a modal, regardless of this setting. |
| `agentSessions.tmuxPath` | `"tmux"` | Path to the tmux binary, if not on `PATH`. |
| `agentSessions.pollIntervalMs` | `1500` | Background poll interval for session state/title updates (also polls on window focus and when the view becomes visible). |
| `agentSessions.fontFamily` | `""` | Terminal pane font. Empty inherits `terminal.integrated.fontFamily`, then `editor.fontFamily`, then falls back to `"CaskaydiaCove Nerd Font"`. Applies live — no reload needed. |

## Uninstalling / cleaning up

Sessions live in a dedicated tmux server, independent of the extension.
Uninstalling the extension does **not** stop running agents. To kill
everything:

```bash
tmux -L agent-sessions kill-server
```

(or run `Agent Sessions: Kill All Agent Sessions` before uninstalling). The
tmux server also exits on its own once its last session ends.

## More documentation

- [docs/architecture.md](docs/architecture.md) — how sessions, tmux, and the
  webview terminal fit together.
- [docs/building.md](docs/building.md) — build from source, package a
  `.vsix`.
- [docs/installing.md](docs/installing.md) — installation options and
  requirements in more detail.
- [docs/testing.md](docs/testing.md) — manual/automated testing notes.
- [docs/learnings.md](docs/learnings.md) — non-obvious findings from
  building and testing this extension.

## License

MIT — see [LICENSE](LICENSE).
