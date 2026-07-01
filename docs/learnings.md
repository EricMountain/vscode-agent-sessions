# Learnings

Findings from actually building and testing this extension that weren't
obvious from [archive/PLAN.md](archive/PLAN.md) going in. Grouped by area.

## tmux backend

### tmux `remain-on-exit` is load-bearing

**Symptom:** `TmuxServer.createSession()` threw
`no server running on /private/tmp/tmux-501/agent-sessions` for any agent
command that exits quickly (a typo'd binary, `exit 0` right away, etc.).

**Cause:** by default a tmux session is destroyed the instant its sole
pane's process exits. `createSession` creates the session, then makes two
more `set-option -t <name> @agentId/@workspace` calls to tag it — if the
command has already finished by then, the session (and, if it was the only
one, the whole server) is already gone, and those calls fail. This isn't a
rare edge case: it's exactly the "agent command not found" scenario the plan
calls out in its edge-cases section, so it needs to work, not just avoid
crashing.

**Fix:** `set-option -g remain-on-exit on` in the bootstrap config
(`src/tmux/tmuxServer.ts`). A dead pane now stays attached to a live
session (`pane_dead=1`, `pane_dead_status=<exit code>`), so tagging always
succeeds and the exit becomes something `SessionStore` can observe and act
on (notify, then kill after a grace period) instead of a race.

### `tmux -f <config>` is safe to pass unconditionally

`-f` is only *applied* when the invocation is the one that boots the
server; for an already-running server it's silently ignored even if the
file doesn't exist. That means there's no need to special-case "first
call" — just always pass `-f <bootstrapConfigPath>` and write that file
once in the constructor.

Relatedly: `tmux set-option -g ...` does **not** start a server on its own
(unlike `new-session`) — confirmed empirically, not documented anywhere
obvious. Only session-creating commands boot the server.

### `list-sessions -F` needs a real delimiter

Pane titles routinely contain spaces, so a space-separated `-F` format
string is ambiguous to parse back. Using an actual `\x1f` (unit separator)
byte between fields — not the four-character string `\x1f`, the literal
byte, which just works as a normal argv element since these commands go
through `execFile` and never touch a shell — parses unambiguously.

### tmux exposes what you need without attaching

`#{pane_title}` (kept live by the agent's own OSC 0/2 sequences),
`#{pane_dead}` / `#{pane_dead_status}`, and `#{session_created}` (used to
derive a stable creation-order ordinal for the `"<label> N"` fallback name)
are all readable via `list-sessions -F` without ever attaching a client.
Only the *active* session needs a real `attach-pty`.

## Packaging

### `.vscodeignore` almost shipped a broken extension

`@homebridge/node-pty-prebuilt-multiarch` ships prebuilt binaries under
`prebuilds/` for **Linux only**. On macOS, `npm install` falls through to
compiling `build/Release/pty.node` from source via `node-gyp`. The first
draft of `.vscodeignore` excluded `node_modules/.../build/**` on the
assumption it was just build-tool cruft — which would have silently
stripped the *only* working native binary for macOS out of the `.vsix`,
while `vsce package` reported success with no warning. Caught by grepping
`vsce ls` output for the package name and noticing `build/Release/pty.node`
wasn't in the list.

Fix: exclude specific junk (`build/*.*`, `build/node-addon-api/**`, `src/`,
`deps/`, `third_party/`) instead of the whole `build/` directory, and keep
`build/Release/pty.node` + `build/Release/spawn-helper` plus the bundled
Linux `prebuilds/`.

### node-pty has no darwin prebuild, but that's OK

The locally-compiled `build/Release/pty.node` is built against whatever
Node.js version ran `npm install` (e.g. system Node 26), not against VS
Code's actual Electron/Node runtime — normally a red flag for native
modules (`NODE_MODULE_VERSION` mismatch). This package uses
`node-addon-api` (N-API), which is ABI-stable across Node/Electron versions
by design, so a single compiled binary is expected to load correctly
regardless of which Node built it. This wasn't independently confirmed
inside actual Electron in this project (see
[testing.md](testing.md#not-yet-verified)) — it's the documented purpose of
N-API, applied here, not a verified fact for this exact binary.

## VS Code integration

### A view container id can collide with a built-in feature

The Activity Bar icon silently failed to render, with no error dialog —
only a console warning: `View container 'agentSessions' requires
'enabledApiProposals: ["chatSessionsProvider"]'`. The installed VS Code's
built-in Copilot extension had already claimed the view container id
`agentSessions` for its own native "chat sessions" feature. Renamed our
container id to `agentSessionsView` (the view id itself, `agentSessions.list`,
and the config namespace `agentSessions.*` were untouched — no collision
reported for either). Worth re-checking if VS Code ships more built-in
"agent"-flavored features in the future; picking a more distinctive
container id up front would have avoided this.

### CSP `style-src` needs `'unsafe-inline'` for xterm.js

A CSP of `style-src ${webview.cspSource}` (no `unsafe-inline`) caused a wall
of "Applying inline style violates the following Content Security Policy
directive" console errors after creating a session. xterm.js's DOM renderer
sets many styles via `element.style.x = y` (cursor, selection, etc.), which
CSP's `style-src` gates regardless of whether it's a `<style>` tag or a JS
`.style` write. Text still rendered in this case, but the blocked styles are
still a correctness bug (cursor/selection appearance), not just noise. Fixed
by adding `'unsafe-inline'` to `style-src` — the documented, standard
requirement for embedding xterm.js in a CSP'd webview.

## Testing VS Code with Playwright

### The "temporarily disabled" banner is not workspace trust

A banner reading "All installed extensions are temporarily disabled" with a
"Reload and Enable Extensions" button appeared on every launch, even with
`--disable-workspace-trust` passed. This is VS Code's crash-safety
mechanism: a prior run's forced `app.close()` (via Playwright) counts as an
abnormal exit, so on the *next* launch of the *same* profile, VS Code
disables all extensions (including the one under
`--extensionDevelopmentPath`) pending explicit re-enable. Fix: wipe and
recreate `--user-data-dir` before every launch in a test script, not just
once.

### `app.close()` can hang with a live pty

Ending a driver script with Playwright's `app.close()` reliably hung
(observed running for minutes past a 45-60s `timeout` wrapper) once a
session with a live attach-pty existed. It's isolated to the automation's
graceful-shutdown negotiation, not the extension: everything up to that
call — activation, clicking, session creation, screenshots — completed
normally and the UI stayed responsive throughout, and the extension's own
`deactivate()` is an intentional no-op with no blocking teardown logic.
Treated as a test-harness quirk of driving a large real Electron app via
CDP, not something to "fix" in the extension. Workaround: end scripts with
`process.exit(0)` and clean up the spawned processes from outside (`pkill
-f <profile-dir>`, `tmux -L agent-sessions kill-server`) instead of relying
on `app.close()` to return.

### Command palette fuzzy-matching can select the wrong item on `Enter`

Typing `"Agent Sessions: Kill Session"` into the command palette and
pressing Enter actually ran `"Agent Sessions: Kill All Agent Sessions"` —
it fuzzy-matched and sorted above the literal, better match and was the
highlighted (default) entry. Confirmed both commands are registered
correctly by screenshotting the palette before pressing Enter. Lesson for
future automation: screenshot-verify the highlighted palette entry before
sending `Enter`, or type enough of the string to disambiguate, don't assume
the literal substring you typed wins.
