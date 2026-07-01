# Building

## Prerequisites

- Node.js and npm
- [tmux](https://github.com/tmux/tmux) on `PATH` (or set `agentSessions.tmuxPath`) — a
  **runtime** dependency of the extension itself, not just the build
- macOS or Linux (Windows is out of scope, see [archive/PLAN.md](archive/PLAN.md) D6)

## Install dependencies

```bash
npm install
```

This pulls in `@homebridge/node-pty-prebuilt-multiarch` (the pty backing the
tmux `attach-session` viewer) and `@xterm/xterm` + addons for the webview.
`node-pty` ships prebuilt binaries for Linux only; on macOS `npm install`
compiles `build/Release/pty.node` from source via `node-gyp` (needs Xcode
command line tools). See
[learnings.md](learnings.md#node-pty-has-no-darwin-prebuild) for why this is
fine despite the mismatch with your local Node ABI.

## Build

```bash
npm run build      # one-shot production build (esbuild, both bundles + xterm.css copy)
npm run watch       # incremental rebuild on save
npm run compile      # tsc --noEmit type-check only, no output
```

`esbuild.js` produces two separate bundles from one config:

| Entry | Output | Platform |
|---|---|---|
| `src/extension.ts` | `out/extension.js` | node (`vscode`, `node-pty` marked external) |
| `src/webview/main.ts` | `media/terminal/main.js` | browser (xterm + addons bundled in) |

It also copies `node_modules/@xterm/xterm/css/xterm.css` to
`media/vendor/xterm.css` on every build.

## Package a `.vsix`

```bash
npm run package     # npm run build && vsce package
```

Read `.vscodeignore` before touching it — it deliberately **keeps**
`node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release/**`
(the compiled macOS binary + its `spawn-helper`) while stripping everything
else under that package (gyp/Makefile intermediates, C++ sources,
Windows-only `deps/`/`third_party/`). See
[learnings.md](learnings.md#vscodeignore-almost-shipped-a-broken-extension)
for why that's the one line in this file you should not "clean up".

The resulting `.vsix` bundles both the locally-compiled macOS binary and the
Linux prebuilds that ship inside the npm package, so one `.vsix` should work
on both target platforms — but only the macOS side has actually been
exercised (see [testing.md](testing.md#not-yet-verified)).

## Verify a build quickly

```bash
npx tsc -p . --noEmit && node esbuild.js --production
```

Both should complete with no errors/warnings and no output beyond the
esbuild start/finish lines.
