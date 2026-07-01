import * as vscode from "vscode";
import { getAgentDefinitions } from "./agentRegistry";
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
    vscode.commands.registerCommand("agentSessions.newSession", async () => {
      const agents = getAgentDefinitions();
      if (agents.length === 0) {
        void vscode.window.showErrorMessage("No agents are configured. Add one via agentSessions.agents.");
        return;
      }
      let agentId = agents[0].id;
      if (agents.length > 1) {
        const pick = await vscode.window.showQuickPick(
          agents.map((agent) => ({ label: agent.label, description: agent.command, agentId: agent.id })),
          { placeHolder: "Select an agent to launch" }
        );
        if (!pick) {
          return;
        }
        agentId = pick.agentId;
      }
      try {
        await store.createSession(agentId);
      } catch (error) {
        void vscode.window.showErrorMessage(`Failed to start agent session: ${(error as Error).message}`);
      }
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
