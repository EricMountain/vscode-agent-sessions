import * as crypto from "crypto";
import * as vscode from "vscode";
import { getAgentDefinition, resolveCwd } from "./agentRegistry";
import { SessionPoller } from "./tmux/poller";
import { TmuxServer } from "./tmux/tmuxServer";
import { SessionState } from "./types";

const ACTIVE_SESSION_KEY = "agentSessions.activeSessionId";

export function workspaceKeyFor(context: vscode.ExtensionContext): string {
  const folders = vscode.workspace.workspaceFolders;
  const seed = folders && folders.length > 0 ? folders.map((f) => f.uri.fsPath).sort().join("|") : context.globalStorageUri.fsPath;
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

export class SessionStore implements vscode.Disposable {
  // How long an "exited" session lingers in the list (so the user can see it
  // failed) before it's automatically killed and removed.
  private static readonly EXIT_GRACE_MS = 2500;

  private sessions: SessionState[] = [];
  private activeId: string | undefined;
  private readonly notifiedExits = new Set<string>();
  private readonly pendingRemoval = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly onDidChangeSessionsEmitter = new vscode.EventEmitter<SessionState[]>();
  private readonly onDidChangeActiveEmitter = new vscode.EventEmitter<string | undefined>();
  readonly onDidChangeSessions = this.onDidChangeSessionsEmitter.event;
  readonly onDidChangeActive = this.onDidChangeActiveEmitter.event;
  readonly poller: SessionPoller;
  readonly workspaceKey: string;

  constructor(private readonly tmux: TmuxServer, private readonly context: vscode.ExtensionContext) {
    this.workspaceKey = workspaceKeyFor(context);
    this.poller = new SessionPoller(tmux, this.workspaceKey);
    this.poller.onDidChange((sessions) => this.handlePollUpdate(sessions));
    this.activeId = context.workspaceState.get<string>(ACTIVE_SESSION_KEY);
  }

  async start(): Promise<void> {
    const config = vscode.workspace.getConfiguration("agentSessions");
    const intervalMs = config.get<number>("pollIntervalMs", 1500);
    const initial = await this.poller.poll();
    this.handlePollUpdate(initial);
    this.poller.start(intervalMs);
  }

  private handlePollUpdate(sessions: SessionState[]): void {
    this.sessions = sessions;
    if (this.activeId && !sessions.some((s) => s.id === this.activeId)) {
      this.setActive(sessions[0]?.id);
    }
    this.reconcileExits(sessions);
    this.onDidChangeSessionsEmitter.fire(this.sessions);
  }

  private reconcileExits(sessions: SessionState[]): void {
    const liveIds = new Set(sessions.map((s) => s.id));
    for (const [id, timer] of this.pendingRemoval) {
      if (!liveIds.has(id)) {
        clearTimeout(timer);
        this.pendingRemoval.delete(id);
        this.notifiedExits.delete(id);
      }
    }

    for (const session of sessions) {
      if (session.status !== "exited" || this.pendingRemoval.has(session.id)) {
        continue;
      }
      if (!this.notifiedExits.has(session.id)) {
        this.notifiedExits.add(session.id);
        const suffix =
          session.exitCode !== undefined && session.exitCode !== 0 ? ` (exit code ${session.exitCode})` : "";
        void vscode.window.showInformationMessage(`Agent session "${session.displayName}" exited${suffix}.`);
      }
      const timer = setTimeout(() => {
        this.pendingRemoval.delete(session.id);
        void this.tmux.killSession(session.tmuxName).then(() => this.poller.poll());
      }, SessionStore.EXIT_GRACE_MS);
      this.pendingRemoval.set(session.id, timer);
    }
  }

  getSessions(): SessionState[] {
    return this.sessions;
  }

  getSession(id: string): SessionState | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  getActiveId(): string | undefined {
    return this.activeId;
  }

  setActive(id: string | undefined): void {
    if (this.activeId === id) {
      return;
    }
    this.activeId = id;
    void this.context.workspaceState.update(ACTIVE_SESSION_KEY, id);
    this.onDidChangeActiveEmitter.fire(id);
  }

  async createSession(agentId: string, cols = 80, rows = 24): Promise<string> {
    const agent = getAgentDefinition(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    const cwd = resolveCwd(agent);
    const { id } = await this.tmux.createSession(agent, cwd, this.workspaceKey, cols, rows);
    const sessions = await this.poller.poll();
    this.handlePollUpdate(sessions);
    this.setActive(id);
    return id;
  }

  async killSession(id: string): Promise<void> {
    const session = this.getSession(id);
    if (!session) {
      return;
    }
    await this.tmux.killSession(session.tmuxName);
    const sessions = await this.poller.poll();
    this.handlePollUpdate(sessions);
  }

  async killAll(): Promise<void> {
    await Promise.all(this.sessions.map((s) => this.tmux.killSession(s.tmuxName)));
    const sessions = await this.poller.poll();
    this.handlePollUpdate(sessions);
  }

  dispose(): void {
    this.poller.dispose();
    for (const timer of this.pendingRemoval.values()) {
      clearTimeout(timer);
    }
    this.pendingRemoval.clear();
    this.onDidChangeSessionsEmitter.dispose();
    this.onDidChangeActiveEmitter.dispose();
  }
}
