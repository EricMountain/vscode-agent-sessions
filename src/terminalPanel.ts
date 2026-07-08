import * as vscode from "vscode";
import { AttachPty } from "./tmux/attachPty";
import { CursorVisibilityCoalescer } from "./tmux/cursorVisibilityCoalescer";
import { SessionStore } from "./sessionStore";
import { ExtToWebviewMessage, WebviewToExtMessage } from "./types";

export const VIEW_TYPE = "agentSessions.terminal";
const FALLBACK_FONT_FAMILY = "CaskaydiaCove Nerd Font Mono, monospace";
const FALLBACK_FONT_SIZE = 14;
// How long to wait for cursor show/hide activity to go quiet before
// forwarding the settled state, when agentSessions.coalesceCursorRedraws is
// on. Comfortably above the ~130ms frame interval measured for Claude
// Code's status-line spinner, so a continuous burst never gets through.
const CURSOR_REDRAW_COALESCE_DELAY_MS = 200;

function resolveCoalesceCursorRedraws(): boolean {
  return vscode.workspace.getConfiguration("agentSessions").get<boolean>("coalesceCursorRedraws", true);
}

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

function resolveFontSize(): number {
  const custom = vscode.workspace.getConfiguration("agentSessions").get<number>("fontSize", 0);
  if (custom > 0) {
    return custom;
  }
  const terminalSize = vscode.workspace.getConfiguration("terminal.integrated").get<number>("fontSize", 0);
  if (terminalSize > 0) {
    return terminalSize;
  }
  const editorSize = vscode.workspace.getConfiguration("editor").get<number>("fontSize", 0);
  if (editorSize > 0) {
    return editorSize;
  }
  return FALLBACK_FONT_SIZE;
}

export class TerminalPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private attachPty: AttachPty | undefined;
  private cursorCoalescer: CursorVisibilityCoalescer | undefined;
  private sessionId: string | undefined;
  private ready = false;
  private cols = 80;
  private rows = 24;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly onDidBecomeActiveEmitter = new vscode.EventEmitter<void>();
  readonly onDidBecomeActive = this.onDidBecomeActiveEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly tmuxPath: string,
    private readonly store: SessionStore
  ) {
    this.disposables.push(this.onDidBecomeActiveEmitter);
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
          event.affectsConfiguration("editor.fontFamily") ||
          event.affectsConfiguration("agentSessions.fontSize") ||
          event.affectsConfiguration("terminal.integrated.fontSize") ||
          event.affectsConfiguration("editor.fontSize")
        ) {
          this.postMessage({ type: "config", fontFamily: resolveFontFamily(), fontSize: resolveFontSize() });
        }
      })
    );
  }

  isActive(): boolean {
    return this.panel?.active ?? false;
  }

  restoreFocus(): void {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn, false);
    }
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
    // Skip redundant reveals: calling reveal() while the panel is already
    // the active tab still triggers a visible flash (and can knock focus
    // back off the webview), which shows up when e.g. opening the Agent
    // Sessions view in response to this panel regaining focus loops back
    // here via the tree's onDidChangeVisibility handler.
    if (!this.panel!.active) {
      this.panel!.reveal(this.panel!.viewColumn, true);
    }
    this.panel!.title = session.displayName;

    if (this.ready && needsActivate) {
      this.activate(sessionId);
    }
  }

  private ensurePanel(): void {
    if (this.panel) {
      return;
    }
    // VS Code is supposed to hand a still-open panel back to us via the
    // WebviewPanelSerializer (see adoptPanel) whenever one survives a
    // restart, but that reconnection is unreliable specifically across an
    // extension-host-only restart (crash, "Restart Extension Host") - VS
    // Code doesn't always deliver the old activation's dispose in time
    // (https://github.com/microsoft/vscode/issues/188257). By the time
    // we're about to create a new panel, any pending adoption has already
    // had its chance to claim one via adoptPanel and set this.panel, so
    // anything still matching our view type here is a genuine leftover -
    // close it rather than leave it as a dead, disconnected tab.
    this.closeStrayTabs();
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, "Agent Session", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: this.localResourceRoots(),
    });
    this.wirePanel(panel);
  }

  private closeStrayTabs(): void {
    const strayTabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes(VIEW_TYPE));
    if (strayTabs.length > 0) {
      void vscode.window.tabGroups.close(strayTabs);
    }
  }

  // Called when VS Code hands back a panel that was still open in the UI
  // from a prior activation (e.g. after an extension host restart) via the
  // WebviewPanelSerializer registered in extension.ts. Without this, a
  // fresh activation would have no way to discover that panel and would
  // always create a brand new one, leaving the old tab orphaned.
  adoptPanel(panel: vscode.WebviewPanel): void {
    if (this.panel) {
      // We already have a live panel; the adopted one is a stray duplicate.
      panel.dispose();
      return;
    }
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.localResourceRoots(),
    };
    this.wirePanel(panel);
  }

  private localResourceRoots(): vscode.Uri[] {
    return [
      vscode.Uri.joinPath(this.context.extensionUri, "media", "terminal"),
      vscode.Uri.joinPath(this.context.extensionUri, "media", "vendor"),
    ];
  }

  private wirePanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media", "terminal");
    const vendorRoot = vscode.Uri.joinPath(this.context.extensionUri, "media", "vendor");
    panel.webview.html = this.renderHtml(panel.webview, mediaRoot, vendorRoot);

    panel.webview.onDidReceiveMessage(
      (message: WebviewToExtMessage) => this.handleWebviewMessage(message),
      undefined,
      this.disposables
    );
    panel.onDidDispose(
      () => {
        this.teardownAttach();
        this.panel = undefined;
        this.ready = false;
      },
      undefined,
      this.disposables
    );
    panel.onDidChangeViewState(
      (event) => {
        if (event.webviewPanel.active) {
          this.onDidBecomeActiveEmitter.fire();
        }
      },
      undefined,
      this.disposables
    );
  }

  private handleWebviewMessage(message: WebviewToExtMessage): void {
    switch (message.type) {
      case "ready":
        this.ready = true;
        this.postMessage({ type: "config", fontFamily: resolveFontFamily(), fontSize: resolveFontSize() });
        if (this.sessionId) {
          this.activate(this.sessionId);
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
      case "openLink":
        if (message.uri) {
          void vscode.env.openExternal(vscode.Uri.parse(message.uri));
        }
        break;
    }
  }

  private activate(sessionId: string): void {
    const session = this.store.getSession(sessionId);
    if (!session || !this.panel) {
      return;
    }
    this.teardownAttach();

    // No capture-pane prefill here: tmux always fully repaints a newly
    // attached client itself, so painting our own snapshot first just
    // means the screen gets drawn twice in quick succession (snapshot,
    // then tmux's own redraw) — visible as a brief flicker on switch.
    const attachPty = new AttachPty(this.tmuxPath, session.tmuxName, this.cols, this.rows);
    this.attachPty = attachPty;
    const cursorCoalescer = new CursorVisibilityCoalescer(
      CURSOR_REDRAW_COALESCE_DELAY_MS,
      resolveCoalesceCursorRedraws,
      (text) => {
        if (this.attachPty === attachPty) {
          this.postMessage({ type: "data", chunk: text });
        }
      }
    );
    this.cursorCoalescer = cursorCoalescer;
    attachPty.onData((chunk) => {
      if (this.attachPty === attachPty) {
        cursorCoalescer.push(chunk);
      }
    });
    attachPty.onExit(() => {
      if (this.attachPty === attachPty) {
        this.attachPty = undefined;
      }
    });

    this.postMessage({ type: "setActiveSession" });
  }

  private teardownAttach(): void {
    this.attachPty?.dispose();
    this.attachPty = undefined;
    this.cursorCoalescer?.dispose();
    this.cursorCoalescer = undefined;
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
