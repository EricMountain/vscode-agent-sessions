# Architecture

Agent Sessions is a VS Code extension that manages independent terminal
sessions running interactive coding agents (Claude Code first, others
configurable). The full design rationale and decision log lives in
[archive/PLAN.md](archive/PLAN.md); this doc describes what was actually
built.

## Core idea

Every agent process lives **outside** the extension host, in a dedicated
[tmux](https://github.com/tmux/tmux) server. The extension host — the
TreeView, the webview terminal, the command handlers — is a disposable
*viewer* onto that server. Reloading the window, or even quitting VS Code
entirely, only tears down the viewer; the tmux server and every agent
session it hosts keep running and get reattached on next activation.

```
Activity Bar (TreeView)          Editor area (one reused webview tab)
┌────────────────────┐           ┌───────────────────────────────┐
│ Agent Sessions      │  select  │  xterm.js renders the ACTIVE   │
│  • hello-agent  🗑   │─────────►│  session's live tmux stream    │
│  • fix-auth *   🗑   │          │                                │
└────────────────────┘           └───────────────────────────────┘
   ▲ poll (title/state)  │ new/kill              ▲   │ input/resize
   │                     ▼                       │   ▼
┌──────────────────────────────────────────────────────────────┐
│ Extension host (disposable): SessionStore, SessionTreeProvider,│
│ TerminalPanel, commands — all rebuilt on every activation       │
└──────────────────────────────────────────────────────────────┘
                  │ tmux CLI (create/list/kill) + one attach-pty
                  ▼ survives reload & full VS Code quit
┌──────────────────────────────────────────────────────────────┐
│ tmux server `tmux -L agent-sessions` (persists independently)  │
│ one session `ag_<id>` per agent; metadata in @-options          │
└──────────────────────────────────────────────────────────────┘
```

## Components

| File | Responsibility |
|---|---|
| `src/extension.ts` | `activate()`: check tmux, build the store/tree/panel, reattach the previously-active session. `deactivate()` is an intentional no-op. |
| `src/agentRegistry.ts` | Reads `agentSessions.agents`, resolves a session's working directory. |
| `src/naming.ts` | Turns a raw tmux pane title into a sanitized display name, with an ordinal fallback. |
| `src/tmux/tmuxServer.ts` | Thin wrapper over the `tmux -L agent-sessions` CLI: create/list/kill/capture. Owns the bootstrap config file (see below). |
| `src/tmux/poller.ts` | Polls `list-sessions` on an interval (default 1.5s, plus on focus/visibility) and emits `SessionState[]` only when something actually changed. |
| `src/tmux/attachPty.ts` | Wraps `node-pty` running `tmux attach-session -t <name>` for whichever session is currently active. Disposable — killing it only detaches the tmux client, the session keeps running. |
| `src/sessionStore.ts` | In-host mirror of session state + the active-session pointer. Owns create/kill/killAll and the "exited session" grace-period auto-removal (see Lifecycle below). |
| `src/sessionTree.ts` | `TreeDataProvider` for the `agentSessions.list` view. |
| `src/terminalPanel.ts` | The single reused `WebviewPanel` + its ext↔webview protocol. |
| `src/webview/main.ts` | Browser-side: xterm.js + fit addon, posts `input`/`resize`, renders `data`/`setActiveSession`/`clear`. |

## tmux session model

- Isolated server: every command runs as `tmux -L agent-sessions …`, so this
  never touches a user's own tmux server.
- One tmux session per agent, named `ag_<12-hex-id>`.
- Metadata lives in tmux user options, not a side-channel file:
  `@agentId` (which `AgentDefinition` launched it) and `@workspace` (a hash
  of the workspace folder paths, used to scope the session list per window).
- The live label comes straight from tmux's own `#{pane_title}`, which tmux
  populates from the agent's OSC 0/2 terminal-title escape sequences — no
  in-host ANSI parsing needed.
- `list-sessions -F` uses `\x1f` (unit separator) as the field delimiter,
  not a space, because pane titles routinely contain spaces.

### Bootstrap config (`build/Release`-style gotcha avoidance)

`TmuxServer`'s constructor writes a small tmux config file into the
extension's `globalStorageUri` and passes it via `-f` on every invocation.
tmux only *applies* `-f` when that invocation is the one that boots the
server — for an already-running server it's silently ignored, which makes
it safe to pass unconditionally instead of special-casing "first call".

The config sets:
```
set-option -g status off
set-option -g history-limit 10000
set-option -g remain-on-exit on
```

`remain-on-exit` is load-bearing, not cosmetic — see
[learnings.md](learnings.md#tmux-remain-on-exit-is-load-bearing).

## Lifecycle

- **Exit detection**: the poller reads `pane_dead` / `pane_dead_status` from
  `list-sessions`. Because of `remain-on-exit`, a dead pane's session stays
  listed (it doesn't vanish the instant the process exits), so `SessionStore`
  can show it as `exited`, notify once, then kill it after a ~2.5s grace
  period (`SessionStore.EXIT_GRACE_MS`).
- **Active-session promotion**: if the active session disappears (killed
  elsewhere, or auto-removed after exiting), `SessionStore` promotes the
  next session in the list, or clears the panel if none remain.
- **Reattach on activate**: the previously-active session id is persisted in
  `workspaceState`; on activation, if it still exists in `list-sessions`,
  `TerminalPanel.show()` is called immediately, spawning a fresh attach-pty.
- **Workspace scoping**: sessions are tagged with `@workspace <hash of the
  sorted workspace-folder paths>` and `list-sessions` is filtered by it, so
  multiple VS Code windows don't show each other's sessions.

## Webview protocol

```
ext → webview:  { type: "setActiveSession", snapshot }   // term.reset() + write snapshot
                { type: "data", chunk }                    // live output
                { type: "clear" }                           // no active session
ext ← webview:  { type: "ready" }
                { type: "input", data }
                { type: "resize", cols, rows }
```

`TerminalPanel.activate()` grabs a `capture-pane -p -e` snapshot before
spawning the new attach-pty, so switching sessions doesn't show a blank
screen while tmux redraws.
