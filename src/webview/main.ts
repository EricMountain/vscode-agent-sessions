import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

interface VsCodeApi {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

const term = new Terminal({
  convertEol: false,
  cursorBlink: true,
  fontFamily: "monospace", // replaced once the "config" message arrives, see below
  fontSize: 13,
  scrollback: 10000,
  allowProposedApi: true,
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

const container = document.getElementById("terminal")!;
term.open(container);
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
  const message = event.data as { type: string; snapshot?: string; chunk?: string; fontFamily?: string };
  switch (message.type) {
    case "config":
      if (message.fontFamily) {
        term.options.fontFamily = message.fontFamily;
        fitAddon.fit();
        postResize();
      }
      break;
    case "setActiveSession":
      term.reset();
      if (message.snapshot) {
        term.write(message.snapshot);
      }
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
