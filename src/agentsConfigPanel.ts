import * as vscode from "vscode";
import {
  getAgentDefinitions,
  getDefaultAgentDefinitions,
  getDefaultAgentId,
  readAgentIconDataUri,
  readIconDataUriForPath,
  updateAgentDefinitions,
  updateDefaultAgentId,
} from "./agentRegistry";
import { AgentDefinition, ConfigFromWebviewMessage } from "./types";

export const CONFIG_VIEW_TYPE = "agentSessions.configureAgents";

export class AgentsConfigPanel {
  private static instance: AgentsConfigPanel | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(private readonly context: vscode.ExtensionContext) {}

  static createOrShow(context: vscode.ExtensionContext): void {
    if (!AgentsConfigPanel.instance) {
      AgentsConfigPanel.instance = new AgentsConfigPanel(context);
    }
    AgentsConfigPanel.instance.show();
  }

  private show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(CONFIG_VIEW_TYPE, "Configure Agents", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media", "config"),
        vscode.Uri.joinPath(this.context.extensionUri, "media", "vendor"),
      ],
    });
    this.panel = panel;
    panel.webview.html = this.renderHtml(panel.webview);
    panel.webview.onDidReceiveMessage(
      (message: ConfigFromWebviewMessage) => this.handleMessage(message),
      undefined,
      this.disposables
    );
    panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      undefined,
      this.disposables
    );
  }

  private handleMessage(message: ConfigFromWebviewMessage): void {
    switch (message.type) {
      case "ready":
        void this.postLoad(getAgentDefinitions(), getDefaultAgentId());
        break;
      case "save":
        void this.save(message.agents, message.defaultAgentId);
        break;
      case "resetDefaults":
        void this.postLoad(getDefaultAgentDefinitions(), getDefaultAgentDefinitions()[0]?.id ?? "");
        break;
      case "pickCwd":
        void this.pickCwd(message.index);
        break;
      case "pickIcon":
        void this.pickIcon(message.index);
        break;
    }
  }

  private async save(agents: AgentDefinition[], defaultAgentId: string): Promise<void> {
    const cleaned = agents
      .map((agent) => ({
        ...agent,
        id: agent.id.trim(),
        label: agent.label.trim(),
        command: agent.command.trim(),
      }))
      .filter((agent) => agent.id && agent.label && agent.command);

    const ids = new Set<string>();
    for (const agent of cleaned) {
      if (ids.has(agent.id)) {
        void vscode.window.showErrorMessage(`Duplicate agent id "${agent.id}" — ids must be unique.`);
        return;
      }
      ids.add(agent.id);
    }
    if (cleaned.length === 0) {
      void vscode.window.showErrorMessage("Add at least one agent with an id, label, and command.");
      return;
    }

    const resolvedDefault = ids.has(defaultAgentId) ? defaultAgentId : cleaned[0].id;
    await updateAgentDefinitions(cleaned);
    await updateDefaultAgentId(resolvedDefault);
    void vscode.window.showInformationMessage("Agent configuration saved.");
    void this.postLoad(cleaned, resolvedDefault);
  }

  private async postLoad(agents: AgentDefinition[], defaultAgentId: string): Promise<void> {
    if (!this.panel) {
      return;
    }
    const previewEntries = await Promise.all(
      agents.map(async (agent) => [agent.id, await readAgentIconDataUri(agent)] as const)
    );
    const iconPreviews: Record<string, string> = {};
    for (const [id, dataUri] of previewEntries) {
      if (dataUri) {
        iconPreviews[id] = dataUri;
      }
    }
    void this.panel.webview.postMessage({ type: "load", agents, defaultAgentId, iconPreviews });
  }

  private async pickCwd(index: number): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select Working Directory",
    });
    if (!picked || picked.length === 0 || !this.panel) {
      return;
    }
    void this.panel.webview.postMessage({ type: "cwdPicked", index, cwd: picked[0].fsPath });
  }

  private async pickIcon(index: number): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Select Icon Image",
      filters: { Images: ["svg", "png", "jpg", "jpeg", "gif", "ico", "webp"] },
    });
    if (!picked || picked.length === 0 || !this.panel) {
      return;
    }
    const iconPath = picked[0].fsPath;
    const dataUri = await readIconDataUriForPath(iconPath);
    void this.panel.webview.postMessage({ type: "iconPicked", index, iconPath, dataUri });
  }

  private renderHtml(webview: vscode.Webview): string {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media", "config");
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
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
