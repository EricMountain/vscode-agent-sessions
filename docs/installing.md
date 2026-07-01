# Installing

## Requirements

- macOS or Linux
- [tmux](https://github.com/tmux/tmux) reachable on `PATH` (or point
  `agentSessions.tmuxPath` at it). The extension checks `tmux -V` on
  activation and shows an error + disables "New Agent Session" if it's
  missing.
- At least one agent CLI installed and on `PATH` — defaults to `claude`
  (Claude Code). Configurable via `agentSessions.agents`.

## Option A: run from source (development)

```bash
npm install
npm run build
code .
```

Then press **F5** (or Run → Start Debugging) to launch an Extension
Development Host with Agent Sessions loaded. This is the fastest loop for
iterating; see [building.md](building.md) for the watch script.

## Option B: install a packaged `.vsix`

```bash
npm run package                                   # produces agent-sessions-0.1.0.vsix
code --install-extension agent-sessions-0.1.0.vsix
```

Then reload/restart VS Code. The Agent Sessions icon should appear in the
Activity Bar.

> Only the macOS build of the bundled native module (`node-pty`) has
> actually been exercised end-to-end. If installing on Linux, verify a
> session can be created and attached before relying on it — see
> [testing.md](testing.md#not-yet-verified).

## Configuration

All settings live under the `agentSessions.*` namespace (Settings UI, search
"Agent Sessions", or edit `settings.json` directly):

| Setting | Default | Notes |
|---|---|---|
| `agentSessions.agents` | `[{ id: "claude-code", label: "Claude Code", command: "claude" }]` | Array of `{ id, label, command, args?, icon?, cwd?, env? }`. More than one entry adds a QuickPick to "New Agent Session". |
| `agentSessions.followTerminalTitle` | `true` | Derive the session label from the agent's own terminal title (OSC 0/2) instead of a static `"<label> N"` name. |
| `agentSessions.confirmKill` | `false` | Ask before killing a single session. `Kill All Agent Sessions` always confirms via a modal, regardless of this setting. |
| `agentSessions.tmuxPath` | `"tmux"` | Path to the tmux binary, if not on `PATH`. |
| `agentSessions.pollIntervalMs` | `1500` | Background poll interval for session state/title updates (also polls on window focus and when the view becomes visible). |

## Uninstalling / cleaning up

Sessions live in a dedicated tmux server, independent of the extension.
Uninstalling the extension does **not** stop running agents. To kill
everything:

```bash
tmux -L agent-sessions kill-server
```

(or use the `Agent Sessions: Kill All Agent Sessions` command before
uninstalling). The tmux server also exits on its own once its last session
ends — this is default tmux behavior, not something the extension manages.
