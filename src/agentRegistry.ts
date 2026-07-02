import * as os from "os";
import * as vscode from "vscode";
import { AgentDefinition } from "./types";

const DEFAULT_AGENTS: AgentDefinition[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    command: "claude",
    env: { CLAUDE_CODE_AUTO_CONNECT_IDE: "true" },
  },
];

export function getAgentDefinitions(): AgentDefinition[] {
  const config = vscode.workspace.getConfiguration("agentSessions");
  const configured = config.get<AgentDefinition[]>("agents");
  if (!configured || configured.length === 0) {
    return DEFAULT_AGENTS;
  }
  return configured.filter((agent) => agent && agent.id && agent.command);
}

export function getAgentDefinition(agentId: string): AgentDefinition | undefined {
  return getAgentDefinitions().find((agent) => agent.id === agentId);
}

export function resolveCwd(agent: AgentDefinition): string {
  if (agent.cwd) {
    return agent.cwd;
  }
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return os.homedir();
}
