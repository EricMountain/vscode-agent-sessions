import * as vscode from "vscode";
import { AttachPty } from "./tmux/attachPty";
import { TmuxServer } from "./tmux/tmuxServer";
import { SessionStore } from "./sessionStore";
import { ExtToWebviewMessage, WebviewToExtMessage } from "./types";

const VIEW_TYPE = "agentSessions.terminal";
const FALLBACK_FONT_FAMILY = "CaskaydiaCove Nerd Font, monospace";

function resolveFontFamily(): string {
  const custom = vscode.workspace.getConfiguration("agentSessions").get<string>("fontFamily", "").trim();
  if (custom) {
    return custom;
  }
  // terminal.integrated.fontFamily itself defaults to "" (inherit editor.fontFamily),
  // so mirror that fallback chain here.
  const terminalFont = vscode.workspace.getConfiguration("terminal.integrated").get<string>("fontFamily", "").trim();
  if (terminalFont) {
    return terminalFont;
  }
  const editorFont = vscode.workspace.getConfiguration("editor").get<string>("fontFamily", "").trim();
  if (editorFont) {
    return editorFont;
  }
  return FALLBACK_FONT_FAMILY;
}

export class TerminalPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private attachPty: AttachPty | undefined;
  private sessionId: string | undefined;
  private ready = false;
  private cols = 80;
  private rows = 24;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly tmux: TmuxServer,
    private readonly tmuxPath: string,
    private readonly store: SessionStore
  ) {
    this.disposables.push(store.onDidChangeActive((id) => this.show(id)));
    this.disposables.push(
      store.onDidChangeSessions(() => {
        if (this.sessionId && !store.getSession(this.sessionId)) {
          // Active session disappeared (killed/exited elsewhere); promote or clear.
          const next = store.getSessions()[0];
          store.setActive(next?.id);
        }
      })
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("agentSessions.fontFamily") ||
          event.affectsConfiguration("terminal.integrated.fontFamily") ||
          event.affectsConfiguration("editor.fontFamily")
        ) {
          this.postMessage({ type: "config", fontFamily: resolveFontFamily() });
        }
      })
    );
  }

  show(sessionId: string | undefined): void {
    if (!sessionId) {
      this.teardownAttach();
      this.sessionId = undefined;
      if (this.panel) {
        this.panel.title = "Agent Session";
        this.postMessage({ type: "clear" });
      }
      return;
    }

    const session = this.store.getSession(sessionId);
    if (!session) {
      return;
    }

    const needsActivate = this.sessionId !== sessionId || !this.attachPty;
    this.sessionId = sessionId;
    this.ensurePanel();
    this.panel!.reveal(this.panel!.viewColumn, true);
    this.panel!.title = session.displayName;

    if (this.ready && needsActivate) {
      void this.activate(sessionId);
    }
  }

  private ensurePanel(): void {
    if (this.panel) {
      return;
    }
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media", "terminal");
    const vendorRoot = vscode.Uri.joinPath(this.context.extensionUri, "media", "vendor");
    this.panel = vscode.window.createWebviewPanel(VIEW_TYPE, "Agent Session", vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot, vendorRoot],
    });
    this.panel.webview.html = this.renderHtml(this.panel.webview, mediaRoot, vendorRoot);

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewToExtMessage) => this.handleWebviewMessage(message),
      undefined,
      this.disposables
    );
    this.panel.onDidDispose(
      () => {
        this.teardownAttach();
        this.panel = undefined;
        this.ready = false;
      },
      undefined,
      this.disposables
    );
  }

  private handleWebviewMessage(message: WebviewToExtMessage): void {
    switch (message.type) {
      case "ready":
        this.ready = true;
        this.postMessage({ type: "config", fontFamily: resolveFontFamily() });
        if (this.sessionId) {
          void this.activate(this.sessionId);
        } else {
          this.postMessage({ type: "clear" });
        }
        break;
      case "input":
        if (message.data) {
          this.attachPty?.write(message.data);
        }
        break;
      case "resize":
        if (message.cols && message.rows) {
          this.cols = message.cols;
          this.rows = message.rows;
          this.attachPty?.resize(message.cols, message.rows);
        }
        break;
    }
  }

  private async activate(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId);
    if (!session || !this.panel) {
      return;
    }
    const snapshot = await this.tmux.capturePane(session.tmuxName);
    // Guard against a stale async response racing a fast session switch.
    if (this.sessionId !== sessionId || !this.panel) {
      return;
    }
    this.teardownAttach();

    const attachPty = new AttachPty(this.tmuxPath, session.tmuxName, this.cols, this.rows);
    this.attachPty = attachPty;
    attachPty.onData((chunk) => {
      if (this.attachPty === attachPty) {
        this.postMessage({ type: "data", chunk });
      }
    });
    attachPty.onExit(() => {
      if (this.attachPty === attachPty) {
        this.attachPty = undefined;
      }
    });

    this.postMessage({ type: "setActiveSession", snapshot });
  }

  private teardownAttach(): void {
    this.attachPty?.dispose();
    this.attachPty = undefined;
  }

  private postMessage(message: ExtToWebviewMessage): void {
    void this.panel?.webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview, mediaRoot: vscode.Uri, vendorRoot: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "main.css"));
    const xtermCssUri = webview.asWebviewUri(vscode.Uri.joinPath(vendorRoot, "xterm.css"));
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${xtermCssUri}" />
<link rel="stylesheet" href="${styleUri}" />
</head>
<body>
<div id="terminal"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.teardownAttach();
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
