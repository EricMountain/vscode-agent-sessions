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
    vscode.commands.registerCommand("agentSessions.newSession", async (agentId?: string) => {
      let resolvedId = agentId ?? getDefaultAgentId();
      if (!resolvedId || !getAgentDefinition(resolvedId)) {
        // On a cold VS Code startup, the very first read of agentSessions.agents
        // can briefly observe a stale config snapshot that self-corrects a
        // moment later (the tree view re-renders fine once it does) — so a
        // single failed lookup isn't proof there's really nothing configured.
        // Give it one short beat to catch up before reporting the error.
        await new Promise((resolve) => setTimeout(resolve, 300));
        resolvedId = agentId ?? getDefaultAgentId();
      }
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
