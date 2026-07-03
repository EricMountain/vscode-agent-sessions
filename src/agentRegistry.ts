import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { AgentDefinition } from "./types";

const DEFAULT_AGENTS: AgentDefinition[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    command: "claude",
    icon: "claude",
    env: { CLAUDE_CODE_AUTO_CONNECT_IDE: "true" },
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    icon: "agent",
  },
  {
    id: "opencode",
    label: "opencode",
    command: "opencode",
    icon: "agent",
  },
  {
    id: "pi",
    label: "pi",
    command: "pi",
    icon: "agent",
  },
];

const ICON_MIME_BY_EXT: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

export function getDefaultAgentDefinitions(): AgentDefinition[] {
  return DEFAULT_AGENTS.map((agent) => ({ ...agent, env: agent.env ? { ...agent.env } : undefined }));
}

export function getAgentDefinitions(): AgentDefinition[] {
  const config = vscode.workspace.getConfiguration("agentSessions");
  const configured = config.get<AgentDefinition[]>("agents");
  if (!configured || configured.length === 0) {
    return getDefaultAgentDefinitions();
  }
  return configured.filter((agent) => agent && agent.id && agent.command);
}

export function getAgentDefinition(agentId: string): AgentDefinition | undefined {
  return getAgentDefinitions().find((agent) => agent.id === agentId);
}

export function getDefaultAgentId(): string {
  const config = vscode.workspace.getConfiguration("agentSessions");
  const configured = config.get<string>("defaultAgentId", "").trim();
  const agents = getAgentDefinitions();
  if (configured && agents.some((agent) => agent.id === configured)) {
    return configured;
  }
  return agents[0]?.id ?? "";
}

function updateTargetFor(config: vscode.WorkspaceConfiguration, key: string): vscode.ConfigurationTarget {
  const inspected = config.inspect(key);
  if (inspected?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }
  if (inspected?.workspaceFolderValue !== undefined) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }
  return vscode.ConfigurationTarget.Global;
}

export async function updateAgentDefinitions(agents: AgentDefinition[]): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentSessions");
  await config.update("agents", agents, updateTargetFor(config, "agents"));
}

export async function updateDefaultAgentId(agentId: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentSessions");
  await config.update("defaultAgentId", agentId, updateTargetFor(config, "defaultAgentId"));
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

// Custom icons are user-chosen files that can live anywhere on disk, so they
// can't simply be declared under a webview's localResourceRoots. Resolving
// to an fs path here lets native TreeItem.iconPath load them directly (no
// webview/CSP involved), while readAgentIconDataUri() below handles the
// webview case by inlining the bytes instead.
export function resolveAgentIconFsPath(agent: AgentDefinition): string | undefined {
  const raw = agent.iconPath?.trim();
  if (!raw) {
    return undefined;
  }
  if (raw.startsWith("~")) {
    return path.join(os.homedir(), raw.slice(1));
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return path.join(folders[0].uri.fsPath, raw);
  }
  return raw;
}

export function resolveAgentTreeIcon(agent: AgentDefinition): vscode.ThemeIcon | vscode.Uri {
  const fsPath = resolveAgentIconFsPath(agent);
  if (fsPath) {
    return vscode.Uri.file(fsPath);
  }
  return new vscode.ThemeIcon(agent.icon?.trim() || "terminal");
}

export async function readAgentIconDataUri(agent: AgentDefinition): Promise<string | undefined> {
  const fsPath = resolveAgentIconFsPath(agent);
  if (!fsPath) {
    return undefined;
  }
  const mime = ICON_MIME_BY_EXT[path.extname(fsPath).toLowerCase()];
  if (!mime) {
    return undefined;
  }
  try {
    const buf = await fs.readFile(fsPath);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function readIconDataUriForPath(fsPath: string): Promise<string | undefined> {
  const mime = ICON_MIME_BY_EXT[path.extname(fsPath).toLowerCase()];
  if (!mime) {
    return undefined;
  }
  try {
    const buf = await fs.readFile(fsPath);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}
