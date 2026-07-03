import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { NewSessionButtonsProvider, NEW_SESSION_BUTTONS_VIEW_TYPE } from "./newSessionButtonsView";
import { SessionStore } from "./sessionStore";
import { SessionTreeProvider } from "./sessionTree";
import { TerminalPanel, VIEW_TYPE } from "./terminalPanel";
import { TmuxServer } from "./tmux/tmuxServer";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentSessions");
  const tmuxPath = config.get<string>("tmuxPath", "tmux");
  const tmuxFocusEvents = config.get<boolean>("tmuxFocusEvents", true);
  const tmux = new TmuxServer(tmuxPath, context.globalStorageUri.fsPath, tmuxFocusEvents);

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

  const newSessionButtonsProvider = new NewSessionButtonsProvider(context);
  context.subscriptions.push(newSessionButtonsProvider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(NEW_SESSION_BUTTONS_VIEW_TYPE, newSessionButtonsProvider)
  );

  const terminalPanel = new TerminalPanel(context, tmuxPath, store);
  context.subscriptions.push(terminalPanel);
  context.subscriptions.push(
    terminalPanel.onDidBecomeActive(() => {
      if (!treeView.visible) {
        void vscode.commands.executeCommand("workbench.view.extension.agentSessionsView", { preserveFocus: true });
      }
    })
  );

  // If a panel from this extension was still open when the extension host
  // restarted (crash, "Restart Extension Host", etc.), VS Code hands it back
  // here instead of leaving it orphaned while a fresh activation spins up a
  // second tab. `storeReady` lets us wait for the session list to finish
  // loading before deciding which session (if any) that panel should show.
  let markStoreReady: () => void;
  const storeReady = new Promise<void>((resolve) => {
    markStoreReady = resolve;
  });
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      deserializeWebviewPanel: async (panel) => {
        terminalPanel.adoptPanel(panel);
        await storeReady;
        const activeId = store.getActiveId();
        if (activeId && store.getSession(activeId)) {
          terminalPanel.show(activeId);
        } else {
          panel.dispose();
        }
      },
    })
  );

  // The tree's own "active" marker (SessionTreeItem's description) updates
  // whenever the model changes, but VS Code's selection highlight does not
  // follow it automatically (e.g. right after creating a session). Keep the
  // visible selection in sync with the active session.
  context.subscriptions.push(
    store.onDidChangeActive((id) => {
      if (!id) {
        return;
      }
      const item = treeProvider.getChildren().find((entry) => entry.session.id === id);
      if (item) {
        void treeView.reveal(item, { select: true, focus: false }).then(undefined, () => undefined);
      }
    })
  );

  // The webview loses DOM focus whenever the OS window itself loses focus,
  // and VS Code does not restore it on refocus. Remember whether the
  // terminal panel was the active one so we can re-reveal it with focus.
  let terminalWasActiveOnBlur = false;
  context.subscriptions.push(
    treeView.onDidChangeVisibility((event) => {
      if (event.visible) {
        void store.poller.poll();
        const activeId = store.getActiveId();
        if (activeId && store.getSession(activeId)) {
          terminalPanel.show(activeId);
        }
      }
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void store.poller.poll();
        if (terminalWasActiveOnBlur) {
          terminalPanel.restoreFocus();
        }
      } else {
        terminalWasActiveOnBlur = terminalPanel.isActive();
      }
    })
  );

  registerCommands(context, store, terminalPanel);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("agentSessions.pollIntervalMs")) {
        const intervalMs = vscode.workspace.getConfiguration("agentSessions").get<number>("pollIntervalMs", 1500);
        store.poller.start(intervalMs);
      }
      if (event.affectsConfiguration("agentSessions.agents") || event.affectsConfiguration("agentSessions.defaultAgentId")) {
        treeProvider.refresh();
        void newSessionButtonsProvider.refresh();
      }
    })
  );

  if (available) {
    await store.start();
  }
  markStoreReady!();
  if (available) {
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
