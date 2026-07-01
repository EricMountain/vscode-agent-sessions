# Agent Sessions — VSCode Extension Implementation Plan

> Status: **Draft for iteration**. Hand-off target: Sonnet for implementation.
> Working name: **Agent Sessions** · extension id `agent-sessions` · config namespace `agentSessions`.

## 1. Objective

A VSCode extension that adds a new **Activity Bar** item managing a set of
independent terminal sessions, each running an interactive agent (Claude Code to
start, others configurable). The activity shows the sessions as a **list**.
From the list the user can:

- Launch new sessions (Claude Code initially; agent catalog is configurable & extensible).
- Open/select a session, displayed in a **single reused editor pane** (one tab that swaps content).
- See each session **auto-named from the agent's own terminal title**, updated live.
- Kill a session via a **bin icon that appears on hover**.

Sessions **survive an extension-host / window reload** and re-attach automatically.
When a session's process exits, it is removed from the list.

## 2. Settled decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Terminal hosting | **Custom webview + `node-pty`** — one reused pane hosting xterm.js, showing the active session. |
| D2 | Session naming | **Live labels derived from the agent's terminal title** (OSC 0/2). No manual/in-place rename in v1. |
| D3 | Session list widget | **Native `TreeView`** — auto-naming removes the need for in-place editing, so the simpler native list wins. Hover bin + click-select are native. |
| D4 | Persistence | **tmux-backed**: each agent runs in an isolated tmux session (`-L agent-sessions`); the extension is a disposable viewer. Survives reload *and* full VSCode quit (§3). |
| D5 | `node-pty` packaging | Prebuilt multi-arch binaries (e.g. `@homebridge/node-pty-prebuilt-multiarch`), shipped unbundled + marked `external`. Used only for the disposable `tmux attach` viewer. |
| D6 | Target platforms | **macOS + Linux.** Windows out of scope. |

## 3. Persistence design — tmux-backed (committed)

Sessions must survive an ext-host reload, so the agent process must **not** be a
child of the extension host. **Decision: run each agent inside a dedicated tmux
session; the extension is a disposable viewer.** (A self-contained detached Node
daemon was considered and rejected — far more code for no benefit now that Windows
is out of scope.)

- **Isolated tmux server.** Use a named socket so we never touch the user's own
  tmux: every command runs as `tmux -L agent-sessions …`. Configure once at setup:
  `set -g status off`, a sensible `history-limit`.
- **Create.** `tmux -L agent-sessions new-session -d -s ag_<id> -x <cols> -y <rows> -- <command …>`.
  Store metadata as tmux **user options** so it persists with the server (no external
  state file): `set-option -t ag_<id> @agentId <id>` / `@label` / `@workspace <hash>`.
- **List / metadata.** One call:
  `tmux -L agent-sessions list-sessions -F '#{session_name} #{@agentId} #{pane_dead} #{pane_title}'`
  → ids, agent, exit state, live title.
- **View the active session.** Spawn a `node-pty` running
  `tmux -L agent-sessions attach -t ag_<id>`, wired to the webview. This pty is
  **disposable**: on reload it dies, the tmux session lives on, and we respawn
  `attach` on reattach. Only the *active* session needs an attach-pty.
- **Live labels without attaching.** tmux captures each pane's title (the agent's
  OSC 0/2) as `#{pane_title}`. A cheap poll (≈1–2s, plus on focus) refreshes
  background labels; the active session's title also arrives live in its attach-pty
  stream. *(Alternative: tmux **control mode** (`-CC`) is a single machine-readable
  event stream — output/renames/exits for all sessions — cleaner but more parser
  code; deferred past v1.)*
- **Scrollback.** Attaching makes tmux redraw the current screen (agents use the
  alternate screen, so this is usually complete). To prefill history on switch,
  optionally `capture-pane -p -e -S -<n>` before attach. Validate in Phase 3.
- **Resize.** Resize the attach-pty to the xterm's `cols/rows`; tmux resizes the
  window to the sole attached client. Store size for reattach.
- **Kill / exit.** Kill: `kill-session -t ag_<id>`. Exit detection: active session →
  attach-pty exits; background → `pane_dead` / disappearance from `list-sessions`.
- **tmux missing** → detect via `tmux -V`, show a clear error, disable New Session.

## 4. Architecture

```
 Activity Bar (native TreeView)     Editor area (single reused tab)
 ┌──────────────────────┐           ┌──────────────────────────────┐
 │ Agent Sessions       │           │  [ Agent Session ]  (1 tab)   │
 │  • Reticulating…  🗑  │  select   │                               │
 │  • Fixing auth  *🗑   │──────────►│   xterm.js renders ACTIVE     │
 │  • Writing tests  🗑  │           │   session's stream            │
 └──────────────────────┘           └──────────────────────────────┘
   ▲ live labels    │ new/kill                  ▲   │ input / resize
   │ (from title)   ▼                           │   ▼
 ┌───────────────────────────────────────────────────────────────┐
 │  Extension host (client): TreeDataProvider, WebviewPanel,       │
 │  command handlers, backend client — ALL disposable on reload    │
 └───────────────────────────────────────────────────────────────┘
                   │  attach-pty (active) + tmux CLI/poll
                   ▼   survives reload & full quit
 ┌───────────────────────────────────────────────────────────────┐
 │  tmux server  `tmux -L agent-sessions`  (persists)              │
 │  agent in session ag_<id>; metadata in @-options; title=pane    │
 └───────────────────────────────────────────────────────────────┘
```

Key point: everything in the ext host is **rebuildable** on reload. The source of
truth (live processes, buffers, names) lives below the IPC boundary.

## 5. Component breakdown

```
package.json            contributes: viewsContainers, views, commands, menus, configuration
esbuild.js              builds: extension (node), webview (browser)
tsconfig.json
src/
  extension.ts          activate(): verify tmux, list + build UI, reattach; deactivate(): dispose viewer only
  agentRegistry.ts      read agentSessions.agents config; default catalog (Claude Code)
  tmux/
    tmuxServer.ts       wrappers over `tmux -L agent-sessions` (create/list/kill/options/capture)
    attachPty.ts        node-pty running `tmux attach` for the active session; input/resize/data
    poller.ts           periodic list-sessions → SessionState[] (labels, status, exit)
  sessionStore.ts       in-host mirror of SessionState[] + active pointer + change events
  sessionTree.ts        TreeDataProvider: rows from sessionStore; live labels; onDidChangeTreeData
  terminalPanel.ts      the single WebviewPanel + ext↔webview protocol; active-session routing
  commands.ts           new / kill / select / killAll
  naming.ts             pane_title → sanitized label
media/
  terminal/main.js|css  webview: xterm.js + fit addon; input/resize → ext; data/replay from ext
  vendor/               xterm.js, xterm-addon-fit, xterm-addon-serialize, xterm.css (bundled)
  icons/                activity-bar.svg, agent icons
```

## 6. Data model

```ts
// agentRegistry.ts
interface AgentDefinition {
  id: string;            // "claude-code"
  label: string;         // "Claude Code"  (fallback name prefix)
  command: string;       // "claude"
  args?: string[];
  icon?: string;         // codicon id or media path
  cwd?: string;          // default: workspace root, else homedir
  env?: Record<string, string>;
}

// mirror state derived from tmux (poller + attach-pty)
type SessionStatus = "running" | "exited";
interface SessionState {
  id: string;            // stable across reloads
  agentId: string;
  title: string;         // latest terminal title (raw)
  displayName: string;   // sanitized title, or "<label> N" fallback (§7)
  status: SessionStatus;
  cols: number;
  rows: number;
}
```

Source of truth per session lives in **tmux**: the agent process in session
`ag_<id>`, metadata in `@`-prefixed options, title as `#{pane_title}`. The ext host
keeps a mirror `SessionState[]` (from the poller + the active attach-pty) plus the
active pointer.

## 7. Live naming (D2)

- Agents set their terminal title via OSC (`ESC]0;…BEL` / `ESC]2;…ST`) — a
  **program-agnostic** signal (Claude Code sets it; verify others like Codex by
  capturing their OSC output once).
- **tmux captures this as `#{pane_title}`**, so no in-host parsing is needed for
  background sessions: the `poller` reads it from `list-sessions`, and the active
  session updates instantly from its attach-pty stream.
- **`displayName` = `sanitize(pane_title)` or `"<agent label> N"`** when empty.
  `sanitize`: strip control chars / spinner glyphs, collapse whitespace, trim ~40 chars.
- **Live updates** push a new `SessionState` → TreeView refresh (and pane title if
  active). **Debounce ~250ms** against busy-TUI thrash.
- Config `agentSessions.followTerminalTitle` (default `true`); when off, use static
  `"<label> N"` names.

## 8. Reused terminal pane (`terminalPanel.ts`)

- Holds a single `WebviewPanel | undefined`.
- `show(sessionId)`:
  - Create panel on first use: `createWebviewPanel("agentSession", title, ViewColumn.Beside, { retainContextWhenHidden: true, enableScripts: true, localResourceRoots: [media] })`; afterwards `panel.reveal(panel.viewColumn)` to reuse the same tab/column.
  - Spawn the attach-pty for `sessionId` (optionally prefill via `capture-pane`); post `setActiveSession { snapshot? }`; webview does `term.reset()` then writes any snapshot; tmux then redraws live.
  - Route the attach-pty `data` to the webview; dispose the previous session's attach-pty first (no cross-talk).
  - Set `panel.title` to the session's `displayName`.
- `onDidDispose`: clear the reference; **do not** kill sessions (they persist).
  Recreate on next `show`.
- On active session exit → promote next session into the pane, or `clear` + empty state.

### Message protocol — terminal webview
```
ext → webview:  { type: "setActiveSession", snapshot }   // reset + replay
                { type: "data", chunk }                    // live output
                { type: "clear" }
ext ← webview:  { type: "ready" }
                { type: "input", data }                    // → active session
                { type: "resize", cols, rows }             // fit addon → resize active session
```

### Resize & scrollback
- Webview uses `xterm-addon-fit`; posts `resize` on container change. Ext resizes
  the attach-pty to `cols/rows`; tmux resizes the window to the sole client. Store
  size for reattach.
- Scrollback: attaching makes tmux redraw the current screen; optionally prefill
  history with `capture-pane -p -e` before attach (§3). Validate in Phase 3.

## 9. Session list (native TreeView — D3)

- `TreeDataProvider` for view `agentSessions.list`. One `TreeItem` per session:
  - `label` = `displayName` (live), `contextValue` = `"session"`, agent icon,
    highlight/`description` for the active + status.
  - **Select**: `TreeView.onDidChangeSelection` → `terminalPanel.show(id)` + set active.
  - **Hover bin**: `killSession` contributed to `view/item/context` with
    `group: "inline"` → shows as a trash icon on hover.
- `onDidChangeTreeData` fires on any backend `SessionState` change (debounced for titles).
- New-session button in `view/title` (`group: navigation`); if `agents.length > 1`,
  `showQuickPick` the catalog, else launch the single agent directly.

## 10. UI contributions (package.json sketch)

```jsonc
"contributes": {
  "viewsContainers": { "activitybar": [{ "id": "agentSessions", "title": "Agent Sessions", "icon": "media/icons/activity-bar.svg" }] },
  "views": { "agentSessions": [{ "id": "agentSessions.list", "name": "Sessions" }] },
  "commands": [
    { "command": "agentSessions.newSession",  "title": "New Agent Session", "icon": "$(add)" },
    { "command": "agentSessions.killSession", "title": "Kill Session",       "icon": "$(trash)" },
    { "command": "agentSessions.killAll",     "title": "Kill All Agent Sessions" }
  ],
  "menus": {
    "view/title":        [{ "command": "agentSessions.newSession",  "when": "view == agentSessions.list", "group": "navigation" }],
    "view/item/context": [{ "command": "agentSessions.killSession", "when": "view == agentSessions.list && viewItem == session", "group": "inline" }]
  },
  "configuration": { "title": "Agent Sessions", "properties": {
    "agentSessions.agents": { "type": "array", "default": [{ "id": "claude-code", "label": "Claude Code", "command": "claude" }], "description": "Available agents that can be launched." },
    "agentSessions.followTerminalTitle": { "type": "boolean", "default": true },
    "agentSessions.confirmKill": { "type": "boolean", "default": false },
    "agentSessions.tmuxPath": { "type": "string", "default": "tmux", "description": "Path to the tmux binary." }
  }}
}
```

## 11. Persistence & reattach flow (D4)

- **Session identity** is the tmux session name `ag_<id>`; the ext host persists
  `activeSessionId` in `workspaceState`.
- **On activate**: check `tmux -V`; `list-sessions` on the `agent-sessions` server;
  build the tree; if `activeSessionId` still exists, `show()` it (spawn attach-pty)
  and let tmux redraw.
- **On ext-host reload**: the attach-pty + webview + tree are torn down and rebuilt;
  the tmux server keeps every agent running, so sessions reappear intact.
- **Workspace scoping**: tag sessions with `@workspace <hash>` and filter
  `list-sessions`, so multiple windows don't show each other's sessions (or accept a
  single shared list — decide in Phase 5).
- **Server lifetime**: persists across reloads and full VSCode quit; ends when its
  last session ends or on reboot. A command `agentSessions.killAll` tears down all
  sessions.

## 12. Lifecycle & edge cases

- **Process exit** → backend emits `exit`; ext removes row; if active, promote next
  or clear pane.
- **Kill from list** → backend SIGTERM → SIGKILL fallback (~2s) → remove. Optional
  `confirmKill`.
- **Close the pane tab** → sessions keep running; reopen via list selection.
- **Reload window** → sessions persist & reattach (§11).
- **Rapid switching** → detach prior data stream before attaching the next.
- **tmux missing / not runnable** (`tmux -V` fails) → clear error notification;
  disable New Session until resolved (optionally offer a non-persistent in-host
  `node-pty` fallback).
- **No workspace folder** → `cwd` falls back to `os.homedir()`.
- **Agent command not found** → session exits with error; surface a toast, brief
  error row, then auto-remove.
- **`deactivate()`** → dispose the **client** only; never kill the backend.

## 13. Build & packaging

- **TypeScript + esbuild**, targets: extension (`platform=node`, `external: vscode, node-pty`)
  and webview (`platform=browser`, bundles xterm + fit + serialize).
- **`node-pty`** via prebuilt-multiarch; shipped **unbundled** in `node_modules`
  inside the `.vsix` (verify with `vsce ls`). Only needed to host the `tmux attach` viewer.
- **xterm assets** copied to `media/vendor`; referenced via `asWebviewUri` + CSP nonce.
- **Packaging** with `@vscode/vsce`; `engines.vscode` ~`^1.90.0`. Smoke-test the
  packaged `.vsix` on **macOS and Linux** (native module + tmux persistence both need it).

## 14. Implementation phases

1. **Scaffold** — contributions, esbuild, activity container + empty TreeView, `New Session` stub.
2. **tmux backend** — `tmuxServer` wrappers (create/list/kill/options), `poller` → `SessionState`, `attachPty` for the active session. Prove `claude` runs in tmux and survives a simulated reload (drop attach-pty → `list-sessions` still shows it → reattach + redraw).
3. **Terminal pane** — xterm webview, attach/input/resize/replay, single reused pane.
4. **TreeView** — live labels from titles, select→show, hover-bin kill, debounced refresh.
5. **Persistence polish** — reattach active session on activate, per-workspace keying, backend idle shutdown, error/fallback paths (§12).
6. **Config & catalog** — `agentSessions.agents`, QuickPick for multiple agents, `followTerminalTitle`.
7. **Packaging** — native module shipping, CSP, cross-platform `.vsix` smoke test.

## 15. Testing

- **Unit**: name sanitization/precedence; backend state reducer (add/remove/active-promotion); protocol encode/decode — with a fake backend.
- **Integration** (`@vscode/test-electron`): view registers, new session adds a row,
  title change updates the label, kill removes it, **reload** re-lists sessions.
- **Manual smoke**: run Claude Code; watch the label track its title; switch between
  2+ sessions (scrollback intact); resize; kill via bin; let an agent `exit` (row
  disappears); **Reload Window → sessions survive and reattach**.

## 16. Risks / watch-list

- **tmux runtime dependency** — detect (`tmux -V`) + surface a clear error if missing.
- **tmux quirks** — ensure `status off` and clean key pass-through so the pane looks
  native; verify `capture-pane` fidelity for history prefill.
- **Native module ABI** (`node-pty`) — prebuilt-multiarch + early packaged-vsix test on macOS & Linux.
- **Reimplemented terminal features** — links, copy/paste, true color, IME (xterm addons cover most).
- **Busy-title thrash** — debounce; consider showing title but keeping a stable tooltip.

---

### Decisions (all settled)
- ✅ D1 Terminal hosting: webview + xterm.js, single reused pane.
- ✅ D2 Naming: live labels from the agent's terminal title (no rename).
- ✅ D3 List widget: native TreeView (hover bin + click select).
- ✅ D4 Persistence: **tmux-backed** (isolated `-L agent-sessions` server; §3).
- ✅ D5 `node-pty`: prebuilt-multiarch, unbundled — hosts the `tmux attach` viewer.
- ✅ D6 Platforms: macOS + Linux; Windows out of scope.

### Minor items to settle during implementation
1. §11 — one shared tmux server/list vs per-workspace `@workspace` scoping (Phase 5).
2. §3/§8 — whether to prefill history via `capture-pane` or rely on tmux's redraw (Phase 3).
3. §3 — poll interval for background labels vs adopting tmux control mode (Phase 4+).
