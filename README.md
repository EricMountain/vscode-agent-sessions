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

- **New Agent Session** — launch one of several configured agent CLIs
  (defaults: Claude Code, Codex, opencode, pi), each in its own tmux session.
- **Pick the agent type per session** — a "New session" row per configured
  agent sits at the bottom of the session list (shifting down as more
  sessions are added); the toolbar "+" always launches the configured
  default agent.
- **Persistent across reloads** — sessions live in a tmux server independent
  of the extension host; the previously active session reattaches
  automatically on activation.
- **Live session list** — a tree view in the Activity Bar showing every
  running session, labeled from the agent's own terminal title, with a
  per-agent icon, exit detection, and one-click kill.
- **Integrated terminal panel** — a reused webview tab (via `xterm.js`)
  renders the active session's live output and forwards your input/resize
  back to tmux.
- **Configurable agents, with a UI** — the gear icon ("Configure Agents")
  opens an editor for the agent list: id, label, command, args, working
  directory, environment variables, an icon (built-in codicon or a custom
  image), and which one is the default — no hand-editing `settings.json`
  required, though that still works too.

## Requirements

- macOS or Linux (Windows is out of scope — tmux isn't available there).
- [tmux](https://github.com/tmux/tmux) reachable on `PATH` (or point
  `agentSessions.tmuxPath` at it). The extension checks `tmux -V` on
  activation and disables "New Agent Session" with an error if it's missing.
- At least one agent CLI installed and on `PATH` — defaults include `claude`
  (Claude Code), `codex`, `opencode`, and `pi`; only the ones you actually
  have installed matter, and unwanted defaults can be removed via Configure
  Agents.

## Getting started

1. Install the extension and make sure `tmux` is on `PATH`.
2. Open the **Agent Sessions** icon in the Activity Bar.
3. Click one of the "New session" rows at the bottom of the list for the
   agent type you want (or the toolbar "+", which always launches the
   configured default agent; or run `Agent Sessions: New Agent Session`
   from the Command Palette).
4. The session opens in the terminal panel and appears in the list. Switch
   between sessions by selecting them in the tree; kill one with the trash
   icon, or all of them via `Agent Sessions: Kill All Agent Sessions`.

Sessions keep running in their tmux server even if you close the panel,
reload the window, or quit VS Code — reopen the workspace and they're still
there.

## Configuration

The friendliest way to edit these is the **Configure Agents** command (gear
icon on the Agent Sessions view, or `Agent Sessions: Configure Agents` from
the Command Palette) — an in-editor form for the agent list and the default
agent, instead of hand-editing JSON. Everything is still backed by regular
settings under `agentSessions.*` (Settings UI → search "Agent Sessions", or
edit `settings.json` directly):

| Setting | Default | Notes |
| --- | --- | --- |
| `agentSessions.agents` | Claude Code, Codex, opencode, pi | Array of `{ id, label, command, args?, icon?, iconPath?, cwd?, env? }`. `icon` is a codicon id (e.g. `"terminal"`, `"rocket"`); `iconPath` (absolute, `~`-relative, or workspace-relative path to an svg/png/etc.) overrides it with a custom image. |
| `agentSessions.defaultAgentId` | `"claude-code"` | Id of the agent launched by the toolbar "+" and by `New Agent Session` when invoked with no explicit agent. Pick a specific type instead via the "New session" rows at the bottom of the session list. |
| `agentSessions.followTerminalTitle` | `true` | Derive the session label from the agent's own terminal title (OSC 0/2) instead of a static `"<label> N"` name. |
| `agentSessions.confirmKill` | `false` | Ask before killing a single session. `Kill All Agent Sessions` always confirms via a modal, regardless of this setting. |
| `agentSessions.tmuxPath` | `"tmux"` | Path to the tmux binary, if not on `PATH`. |
| `agentSessions.pollIntervalMs` | `1500` | Background poll interval for session state/title updates (also polls on window focus and when the view becomes visible). |
| `agentSessions.fontFamily` | `""` | Terminal pane font. Empty inherits `terminal.integrated.fontFamily`, then `editor.fontFamily`, then falls back to `\"CaskaydiaCove Nerd Font Mono\"`. Applies live — no reload needed. |
| `agentSessions.coalesceCursorRedraws` | `true` | Collapse rapid cursor show/hide escape sequences (e.g. Claude Code's animated status line redrawing several times a second while processing) into a single change after a brief pause, instead of flashing the cursor on every redraw. Disable to forward every cursor visibility change unmodified. |

## Uninstalling / cleaning up

Sessions live in a dedicated tmux server, independent of the extension.
Uninstalling the extension does **not** stop running agents. To kill
everything:

```bash
tmux -L agent-sessions kill-server
```

(or run `Agent Sessions: Kill All Agent Sessions` before uninstalling). The
tmux server also exits on its own once its last session ends.

## Troubleshooting

### Bottom panel pops open randomly

**The bottom Panel keeps popping open with a terminal while an agent is
working, stealing focus from the Agent Sessions tab.**

This extension only ever renders sessions in its own webview tab and never
creates or reveals a native VS Code terminal.

If you also have the official
[Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code)
extension installed, check its `claudeCode.useTerminal` setting. When set to
`true`, that extension runs the `claude` CLI in a real integrated terminal
instead of its own native UI, and VS Code reveals the Panel group each time
that terminal needs to run or update. For some reason (IDE integration?), that seems to interfere
with processing of a prompt in a session run by this extension. Set
`"claudeCode.useTerminal": false` in `settings.json` to have it use its native UI
instead, which doesn't touch the Panel.

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
