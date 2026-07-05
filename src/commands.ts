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
  terminalPanel: TerminalPanel,
  output: vscode.OutputChannel
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("agentSessions.newSession", async (agentId?: string) => {
      // Diagnosing an intermittent "No agents are configured" report on this
      // exact command (occurs on the toolbar "+" far more than via other
      // entry points that resolve to the same call with the same arguments).
      // Log the raw config on every invocation so the next failure has real
      // evidence attached instead of another guess.
      const config = vscode.workspace.getConfiguration("agentSessions");
      const rawAgents = config.get("agents");
      const rawDefaultAgentId = config.get("defaultAgentId");
      output.appendLine(
        `[newSession] ${new Date().toISOString()} agentId=${agentId ?? "<none>"} ` +
          `rawDefaultAgentId=${JSON.stringify(rawDefaultAgentId)} ` +
          `rawAgentIds=${JSON.stringify((rawAgents as { id?: string }[] | undefined)?.map((a) => a?.id))}`
      );

      let resolvedId = agentId ?? getDefaultAgentId();
      for (let attempt = 0; attempt < 5 && (!resolvedId || !getAgentDefinition(resolvedId)); attempt++) {
        output.appendLine(
          `[newSession]   attempt ${attempt}: resolvedId=${JSON.stringify(resolvedId)} found=${Boolean(
            resolvedId && getAgentDefinition(resolvedId)
          )}, retrying in 200ms`
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        resolvedId = agentId ?? getDefaultAgentId();
      }
      if (!resolvedId || !getAgentDefinition(resolvedId)) {
        output.appendLine(`[newSession] FAILED: resolvedId=${JSON.stringify(resolvedId)}, giving up`);
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
