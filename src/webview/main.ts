import { Terminal, ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";

interface VsCodeApi {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

// VS Code injects every theme color as a `--vscode-<colorId>` CSS custom
// property on the webview body, and keeps it live-updated (including
// toggling a vscode-light/vscode-dark/vscode-high-contrast class) whenever
// the active color theme changes - including when it changes because the
// user has VS Code set to follow the OS light/dark setting. Reading these
// at runtime means the terminal's colors always match VS Code's current
// theme without us needing to duplicate any theme/OS detection logic.
function cssVar(name: string): string | undefined {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value.length > 0 ? value : undefined;
}

function buildXtermTheme(): ITheme {
  const theme: ITheme = {};
  const set = (key: keyof ITheme, ...cssNames: string[]) => {
    for (const cssName of cssNames) {
      const value = cssVar(cssName);
      if (value) {
        (theme as Record<string, string>)[key] = value;
        return;
      }
    }
  };
  // terminal.background/terminal.foreground have no theme-registry default -
  // VS Code's real integrated terminal derives them at runtime from
  // panel/editor colors instead, so most themes never emit these two CSS
  // vars at all. Without a fallback here xterm silently keeps its own
  // hardcoded black/near-white defaults regardless of the active theme.
  set("background", "--vscode-terminal-background", "--vscode-panel-background", "--vscode-editor-background");
  set("foreground", "--vscode-terminal-foreground", "--vscode-foreground", "--vscode-editor-foreground");
  set("cursor", "--vscode-terminalCursor-foreground", "--vscode-terminal-foreground", "--vscode-foreground");
  set("cursorAccent", "--vscode-terminalCursor-background", "--vscode-terminal-background", "--vscode-panel-background");
  set("selectionBackground", "--vscode-terminal-selectionBackground", "--vscode-editor-selectionBackground");
  set("selectionForeground", "--vscode-terminal-selectionForeground");
  set("black", "--vscode-terminal-ansiBlack");
  set("red", "--vscode-terminal-ansiRed");
  set("green", "--vscode-terminal-ansiGreen");
  set("yellow", "--vscode-terminal-ansiYellow");
  set("blue", "--vscode-terminal-ansiBlue");
  set("magenta", "--vscode-terminal-ansiMagenta");
  set("cyan", "--vscode-terminal-ansiCyan");
  set("white", "--vscode-terminal-ansiWhite");
  set("brightBlack", "--vscode-terminal-ansiBrightBlack");
  set("brightRed", "--vscode-terminal-ansiBrightRed");
  set("brightGreen", "--vscode-terminal-ansiBrightGreen");
  set("brightYellow", "--vscode-terminal-ansiBrightYellow");
  set("brightBlue", "--vscode-terminal-ansiBrightBlue");
  set("brightMagenta", "--vscode-terminal-ansiBrightMagenta");
  set("brightCyan", "--vscode-terminal-ansiBrightCyan");
  set("brightWhite", "--vscode-terminal-ansiBrightWhite");
  return theme;
}

const term = new Terminal({
  convertEol: false,
  cursorBlink: true,
  fontFamily: "monospace", // replaced once the "config" message arrives, see below
  fontSize: 13,
  scrollback: 10000,
  allowProposedApi: true,
  theme: buildXtermTheme(),
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

// xterm's built-in width table predates Unicode 9+, so it renders emoji and
// wide CJK glyphs a column narrower than they actually draw - most visible
// with the Nerd Font default, where those glyphs are common. This addon
// swaps in an up-to-date wcwidth table.
term.loadAddon(new Unicode11Addon());
term.unicode.activeVersion = "11";

// Cmd-click (macOS) / Ctrl-click (Windows, Linux) opens links, matching
// iTerm/VS Code terminal convention. The addon's default handler uses
// window.open(), which doesn't work from inside a webview iframe, so we
// route through the extension host instead.
const isMac = navigator.userAgent.includes("Macintosh");
term.loadAddon(
  new WebLinksAddon((event, uri) => {
    if (isMac ? !event.metaKey : !event.ctrlKey) {
      return;
    }
    vscode.postMessage({ type: "openLink", uri });
  })
);

// VS Code toggles a class on <body> (vscode-light/vscode-dark/vscode-high-contrast)
// in place when the active color theme changes, rather than reloading the
// webview, so we watch for that to keep the terminal palette in sync live.
new MutationObserver(() => {
  term.options.theme = buildXtermTheme();
}).observe(document.body, { attributes: true, attributeFilter: ["class"] });

const container = document.getElementById("terminal")!;
term.open(container);

// The default DOM renderer redraws every visible row as a DOM node, which
// gets sluggish for scrolling once there's a lot of scrollback. WebGL
// renders through a single canvas instead. It can lose its context (e.g.
// GPU process crash), so fall back to the DOM renderer rather than leaving
// the terminal unrendered.
try {
  const webglAddon = new WebglAddon();
  webglAddon.onContextLoss(() => {
    webglAddon.dispose();
  });
  term.loadAddon(webglAddon);
} catch {
  // WebGL unavailable; xterm falls back to its default DOM renderer.
}

fitAddon.fit();

term.onData((data) => {
  vscode.postMessage({ type: "input", data });
});

function postResize(): void {
  vscode.postMessage({ type: "resize", cols: term.cols, rows: term.rows });
}

fitAddon.fit();
postResize();

const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit();
  postResize();
});
resizeObserver.observe(container);

window.addEventListener("message", (event) => {
  const message = event.data as { type: string; chunk?: string; fontFamily?: string; fontSize?: number };
  switch (message.type) {
    case "config": {
      let changed = false;
      if (message.fontFamily) {
        term.options.fontFamily = message.fontFamily;
        changed = true;
      }
      if (message.fontSize) {
        term.options.fontSize = message.fontSize;
        changed = true;
      }
      if (changed) {
        fitAddon.fit();
        postResize();
      }
      break;
    }
    case "setActiveSession":
      term.reset();
      fitAddon.fit();
      postResize();
      term.focus();
      break;
    case "data":
      if (message.chunk) {
        term.write(message.chunk);
      }
      break;
    case "clear":
      term.reset();
      term.write("No active agent session. Select or start one from the Agent Sessions view.");
      break;
  }
});

vscode.postMessage({ type: "ready" });
