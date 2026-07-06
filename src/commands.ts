import * as vscode from "vscode";
import { AgentsConfigPanel } from "./agentsConfigPanel";
import { getAgentDefinition, getDefaultAgentId } from "./agentRegistry";
import { SessionStore } from "./sessionStore";
import { SessionTreeItem } from "./sessionTree";
import { TerminalPanel } from "./terminalPanel";

function resolveSessionId(target: SessionTreeItem | string | undefined, store: SessionStore): string | undefined {
  if (typeof target === "string") {
    return target;
  }
  if (target instanceof SessionTreeItem) {
    return target.session.id;
  }
  return store.getActiveId();
}

export function registerCommands(
  context: vscode.ExtensionContext,
  store: SessionStore,
  terminalPanel: TerminalPanel
): void {
  context.subscriptions.push(
    // The view/title toolbar button for this command has no associated tree
    // item, but VS Code still forwards the tree view's *current selection* as
    // the first argument whenever one exists (the same plumbing used for
    // item-scoped commands) — so once any session row has been selected,
    // this fires with that SessionTreeItem instead of undefined. Only trust
    // a real string id (as passed explicitly by the per-agent "New session"
    // rows); anything else means "no explicit agent requested".
    vscode.commands.registerCommand("agentSessions.newSession", async (arg?: string | SessionTreeItem) => {
      const explicitAgentId = typeof arg === "string" ? arg : undefined;
      const resolvedId = explicitAgentId ?? getDefaultAgentId();
      if (!resolvedId || !getAgentDefinition(resolvedId)) {
        void vscode.window.showErrorMessage("No agents are configured. Add one via the \"Configure Agents\" gear icon.");
        return;
      }
      try {
        await store.createSession(resolvedId);
      } catch (error) {
        void vscode.window.showErrorMessage(`Failed to start agent session: ${(error as Error).message}`);
      }
    }),

    vscode.commands.registerCommand("agentSessions.configureAgents", () => {
      AgentsConfigPanel.createOrShow(context);
    }),

    vscode.commands.registerCommand("agentSessions.selectSession", (id: string) => {
      store.setActive(id);
      terminalPanel.show(id);
    }),

    vscode.commands.registerCommand("agentSessions.killSession", async (target?: SessionTreeItem | string) => {
      const id = resolveSessionId(target, store);
      if (!id) {
        return;
      }
      const confirmKill = vscode.workspace.getConfiguration("agentSessions").get<boolean>("confirmKill", false);
      if (confirmKill) {
        const session = store.getSession(id);
        const choice = await vscode.window.showWarningMessage(
          `Kill session "${session?.displayName ?? id}"?`,
          { modal: true },
          "Kill"
        );
        if (choice !== "Kill") {
          return;
        }
      }
      await store.killSession(id);
    }),

    vscode.commands.registerCommand("agentSessions.killAll", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Kill all agent sessions? This will terminate every running agent.",
        { modal: true },
        "Kill All"
      );
      if (choice !== "Kill All") {
        return;
      }
      await store.killAll();
    }),

    vscode.commands.registerCommand("agentSessions.refresh", async () => {
      await store.poller.poll();
    })
  );
}
