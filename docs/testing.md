# Testing

There is no committed automated test suite yet — everything below is the
methodology used to verify the implementation, so it can be repeated or
turned into real tests later. All ad-hoc scripts used during development
were written under `.tmp/` (gitignored, scratch-only) and are gone; the
techniques are worth keeping.

## 1. Backend logic, without VS Code at all

`src/tmux/tmuxServer.ts` has no dependency on the `vscode` module, so it can
be bundled standalone and driven directly from Node — much faster than
launching VS Code for every iteration:

```bash
npx esbuild src/tmux/tmuxServer.ts --bundle --platform=node --format=cjs \
  --outfile=.tmp/tmuxServer.test.js
node -e '
  const { TmuxServer } = require("./.tmp/tmuxServer.test.js");
  (async () => {
    const tmux = new TmuxServer("tmux", ".tmp/storage");
    const agent = { id: "x", label: "X", command: "bash", args: ["-c", "echo hi; sleep 60"] };
    const { tmuxName } = await tmux.createSession(agent, process.cwd(), "ws1", 80, 24);
    console.log(await tmux.listSessions("ws1"));
    console.log(await tmux.capturePane(tmuxName));
    await tmux.killSession(tmuxName);
  })();
'
```

This is how the exit-race bug and the `remain-on-exit` fix were found and
confirmed (see [learnings.md](learnings.md)) — including deliberately
spawning agents that exit instantly or reference a nonexistent binary, and
checking `list-sessions`/`capture-pane` afterwards.

`node-pty` itself can be exercised the same way, spawning
`tmux -L agent-sessions attach-session -t <name>` directly and checking
`onData`/`onExit`/`resize`, without any VS Code involved.

Always use an isolated tmux socket for these (`agent-sessions`, or a
throwaway name), and `tmux -L <socket> kill-server` between runs — otherwise
state leaks across test runs.

## 2. Manual smoke test, in VS Code

Standard extension-development loop:

```bash
npm run build
code .        # then press F5, or "Debug: Start Debugging"
```

This opens an Extension Development Host with the extension loaded from
source. Walk the golden path: click the Agent Sessions activity bar icon →
"New Agent Session" → confirm it appears in the tree with a live label →
confirm the terminal pane shows real output → kill it via the hover bin
icon → reload the window and confirm a still-running session reattaches.

## 3. Driving VS Code programmatically (Playwright)

For a scripted (non-interactive) smoke test, launch the **real** installed
VS Code Electron binary via Playwright's `_electron`, pointed at this repo
with `--extensionDevelopmentPath`:

```js
import { _electron as electron } from "playwright-core"; // npm install playwright-core, isolated, not a project dependency
const app = await electron.launch({
  executablePath: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron", // macOS
  args: [
    "--extensionDevelopmentPath=" + REPO,
    "--disable-workspace-trust",
    "--user-data-dir=" + FRESH_TMP_DIR,   // always fresh, see learnings.md
    "--new-window",
    REPO,
  ],
});
const page = await app.firstWindow();
// page.evaluate(...) to click by aria-label, page.screenshot(...), page.on("console", ...)
```

This is exactly how the activity-bar collision, the CSP violation, and the
end-to-end create → tree → webview flow were verified for this project —
see [learnings.md](learnings.md) for the specific gotchas hit along the way
(workspace trust vs. "abnormal exit" banners, `app.close()` hanging with a
live pty, command-palette fuzzy matching).

Prefer `process.exit(0)` over `app.close()` to end a script — see
[learnings.md](learnings.md#appclose-can-hang-with-a-live-pty).

To avoid depending on the real `claude` CLI (auth, cost, nondeterminism)
during automated checks, override the agent catalog in the fresh profile's
`User/settings.json` before launching:

```json
{ "agentSessions.agents": [{ "id": "test-echo", "label": "Test Echo", "command": "bash", "args": ["-c", "echo hello; sleep 30"] }] }
```

### Not yet verified

- **Linux.** Everything above was run on macOS only. The `.vsix` bundles
  Linux `node-pty` prebuilds, but that side has never actually been
  installed and exercised on a Linux machine.
- **A real full VS Code quit/reload** with an active session (only
  `Reload Window`-equivalent teardown via the Playwright driver was
  exercised, and that specific automation path is known to hang — see
  learnings — so a real, interactive quit hasn't been separately confirmed
  clean).
- **Formal `@vscode/test-electron` suite.** No committed test files exist;
  the methodology above would translate reasonably directly into one.
