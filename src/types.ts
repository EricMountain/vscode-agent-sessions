export interface AgentDefinition {
  id: string;
  label: string;
  command: string;
  args?: string[];
  icon?: string;
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
  type: "ready" | "input" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
}

export interface ExtToWebviewMessage {
  type: "setActiveSession" | "data" | "clear" | "config";
  chunk?: string;
  fontFamily?: string;
}
