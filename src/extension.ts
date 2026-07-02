import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { SessionStore } from "./sessionStore";
import { SessionTreeProvider } from "./sessionTree";
import { TerminalPanel } from "./terminalPanel";
import { TmuxServer } from "./tmux/tmuxServer";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const tmuxPath = vscode.workspace.getConfiguration("agentSessions").get<string>("tmuxPath", "tmux");
  const tmux = new TmuxServer(tmuxPath, context.globalStorageUri.fsPath);

  const available = await tmux.isAvailable();
  await vscode.commands.executeCommand("setContext", "agentSessions.tmuxAvailable", available);
  if (!available) {
    void vscode.window.showErrorMessage(
      `Agent Sessions: tmux was not found at "${tmuxPath}". Sessions cannot be created or restored until tmux is installed and reachable.`
    );
  }

  const store = new SessionStore(tmux, context);
  context.subscriptions.push(store);

  const treeProvider = new SessionTreeProvider(store);
  const treeView = vscode.window.createTreeView("agentSessions.list", {
    treeDataProvider: treeProvider,
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(
    treeView.onDidChangeVisibility((event) => {
      if (event.visible) {
        void store.poller.poll();
      }
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void store.poller.poll();
      }
    })
  );

  const terminalPanel = new TerminalPanel(context, tmuxPath, store);
  context.subscriptions.push(terminalPanel);

  registerCommands(context, store, terminalPanel);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("agentSessions.pollIntervalMs")) {
        const intervalMs = vscode.workspace.getConfiguration("agentSessions").get<number>("pollIntervalMs", 1500);
        store.poller.start(intervalMs);
      }
    })
  );

  if (available) {
    await store.start();
    const activeId = store.getActiveId();
    if (activeId && store.getSession(activeId)) {
      terminalPanel.show(activeId);
    }
  }
}

export function deactivate(): void {
  // Intentionally no-op: the tmux server and every agent session it hosts
  // must keep running after the extension host (and even VS Code) exits.
}
