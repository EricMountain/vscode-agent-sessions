export interface AgentDefinition {
  id: string;
  label: string;
  command: string;
  args?: string[];
  icon?: string;
  iconPath?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export type SessionStatus = "running" | "exited";

export interface SessionState {
  id: string;
  tmuxName: string;
  agentId: string;
  title: string;
  displayName: string;
  status: SessionStatus;
  exitCode: number | undefined;
  cols: number;
  rows: number;
}

export interface WebviewToExtMessage {
  type: "ready" | "input" | "resize" | "openLink";
  data?: string;
  cols?: number;
  rows?: number;
  uri?: string;
}

export interface ExtToWebviewMessage {
  type: "setActiveSession" | "data" | "clear" | "config";
  chunk?: string;
  fontFamily?: string;
  fontSize?: number;
}

export interface AgentButtonSummary {
  id: string;
  label: string;
  icon?: string;
  iconDataUri?: string;
}

export type ButtonsToWebviewMessage = {
  type: "agents";
  agents: AgentButtonSummary[];
  defaultAgentId: string;
};

export type ButtonsFromWebviewMessage =
  | { type: "ready" }
  | { type: "newSession"; agentId: string }
  | { type: "configureAgents" };

export type ConfigToWebviewMessage =
  | { type: "load"; agents: AgentDefinition[]; defaultAgentId: string; iconPreviews: Record<string, string> }
  | { type: "iconPicked"; index: number; iconPath: string; dataUri?: string }
  | { type: "cwdPicked"; index: number; cwd: string };

export type ConfigFromWebviewMessage =
  | { type: "ready" }
  | { type: "save"; agents: AgentDefinition[]; defaultAgentId: string }
  | { type: "pickCwd"; index: number }
  | { type: "pickIcon"; index: number }
  | { type: "resetDefaults" };
