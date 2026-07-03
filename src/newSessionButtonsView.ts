import * as vscode from "vscode";
import { getAgentDefinitions, getDefaultAgentId, readAgentIconDataUri } from "./agentRegistry";
import { AgentButtonSummary, ButtonsFromWebviewMessage } from "./types";

export const NEW_SESSION_BUTTONS_VIEW_TYPE = "agentSessions.newSessionButtons";

export class NewSessionButtonsProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media", "buttons"), vscode.Uri.joinPath(this.context.extensionUri, "media", "vendor")],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(
      (message: ButtonsFromWebviewMessage) => this.handleMessage(message),
      undefined,
      this.disposables
    );
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
      }
    });
  }

  async refresh(): Promise<void> {
    if (!this.view || !this.ready) {
      return;
    }
    const agents = getAgentDefinitions();
    const summaries: AgentButtonSummary[] = await Promise.all(
      agents.map(async (agent) => ({
        id: agent.id,
        label: agent.label,
        icon: agent.icon,
        iconDataUri: await readAgentIconDataUri(agent),
      }))
    );
    void this.view.webview.postMessage({
      type: "agents",
      agents: summaries,
      defaultAgentId: getDefaultAgentId(),
    });
  }

  private handleMessage(message: ButtonsFromWebviewMessage): void {
    switch (message.type) {
      case "ready":
        this.ready = true;
        void this.refresh();
        break;
      case "newSession":
        void vscode.commands.executeCommand("agentSessions.newSession", message.agentId);
        break;
      case "configureAgents":
        void vscode.commands.executeCommand("agentSessions.configureAgents");
        break;
    }
  }

  private renderHtml(webview: vscode.Webview): string {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media", "buttons");
    const vendorRoot = vscode.Uri.joinPath(this.context.extensionUri, "media", "vendor");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "main.css"));
    const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(vendorRoot, "codicon.css"));
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${codiconUri}" />
<link rel="stylesheet" href="${styleUri}" />
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
