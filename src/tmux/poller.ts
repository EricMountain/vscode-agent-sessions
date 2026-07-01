import * as vscode from "vscode";
import { getAgentDefinition, getAgentDefinitions } from "../agentRegistry";
import { computeDisplayName } from "../naming";
import { SessionState } from "../types";
import { TmuxServer } from "./tmuxServer";

export class SessionPoller implements vscode.Disposable {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<SessionState[]>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private lastSerialized = "";

  constructor(private readonly tmux: TmuxServer, private readonly workspaceKey: string) {}

  start(intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => void this.poll(), intervalMs);
    void this.poll();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async poll(): Promise<SessionState[]> {
    const config = vscode.workspace.getConfiguration("agentSessions");
    const followTerminalTitle = config.get<boolean>("followTerminalTitle", true);
    const infos = await this.tmux.listSessions(this.workspaceKey);

    const ordinalByAgent = new Map<string, number>();
    const states: SessionState[] = infos.map((info) => {
      const ordinal = (ordinalByAgent.get(info.agentId) ?? 0) + 1;
      ordinalByAgent.set(info.agentId, ordinal);
      const agent = getAgentDefinition(info.agentId);
      const agentLabel = agent?.label ?? getAgentDefinitions()[0]?.label ?? "Agent";
      return {
        id: info.id,
        tmuxName: info.tmuxName,
        agentId: info.agentId,
        title: info.title,
        displayName: computeDisplayName(info.title, agentLabel, ordinal, followTerminalTitle),
        status: info.dead ? "exited" : "running",
        exitCode: info.exitCode,
        cols: 0,
        rows: 0,
      };
    });

    const serialized = JSON.stringify(states);
    if (serialized !== this.lastSerialized) {
      this.lastSerialized = serialized;
      this.onDidChangeEmitter.fire(states);
    }
    return states;
  }

  dispose(): void {
    this.stop();
    this.onDidChangeEmitter.dispose();
  }
}
