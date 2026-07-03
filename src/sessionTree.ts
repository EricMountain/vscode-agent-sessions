import * as vscode from "vscode";
import { getAgentDefinition, getAgentDefinitions, getDefaultAgentId, resolveAgentTreeIcon } from "./agentRegistry";
import { SessionStore } from "./sessionStore";
import { AgentDefinition, SessionState } from "./types";

export class SessionTreeItem extends vscode.TreeItem {
  constructor(readonly session: SessionState, isActive: boolean) {
    super(session.displayName, vscode.TreeItemCollapsibleState.None);
    this.id = session.id;
    this.contextValue = "session";
    this.description = session.status === "exited" ? "exited" : isActive ? "•" : undefined;
    this.tooltip = session.title || session.displayName;
    const agent = getAgentDefinition(session.agentId);
    this.iconPath = agent ? resolveAgentTreeIcon(agent) : new vscode.ThemeIcon("terminal");
    this.command = {
      command: "agentSessions.selectSession",
      title: "Open Agent Session",
      arguments: [session.id],
    };
  }
}

// Trailing, always-present rows appended after the real sessions so "start a
// new one" stays a single click without a separate view/section — they just
// shift down as more sessions are added, per the user's request.
export class NewSessionTreeItem extends vscode.TreeItem {
  constructor(agent: AgentDefinition, isDefault: boolean) {
    super(agent.label, vscode.TreeItemCollapsibleState.None);
    this.id = `new-session:${agent.id}`;
    this.contextValue = "newSessionButton";
    this.description = isDefault ? "New session (default)" : "New session";
    this.tooltip = `Start a new ${agent.label} session`;
    this.iconPath = resolveAgentTreeIcon(agent);
    this.command = {
      command: "agentSessions.newSession",
      title: "New Agent Session",
      arguments: [agent.id],
    };
  }
}

// TreeItem has no native separator widget (unlike QuickPickItemKind.Separator),
// so fake a thin dividing line with an inert, unlabeled row between the real
// sessions and the trailing "new session" rows.
export class SeparatorTreeItem extends vscode.TreeItem {
  constructor() {
    super("──────────────────────────", vscode.TreeItemCollapsibleState.None);
    this.id = "new-session-separator";
    this.contextValue = "separator";
  }
}

export type AgentSessionsTreeItem = SessionTreeItem | NewSessionTreeItem | SeparatorTreeItem;

export class SessionTreeProvider implements vscode.TreeDataProvider<AgentSessionsTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly store: SessionStore, private readonly tmuxAvailable: boolean) {
    this.store.onDidChangeSessions(() => this.onDidChangeTreeDataEmitter.fire());
    this.store.onDidChangeActive(() => this.onDidChangeTreeDataEmitter.fire());
  }

  getTreeItem(element: AgentSessionsTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(): undefined {
    // Flat list: every item is a root element.
    return undefined;
  }

  getChildren(): AgentSessionsTreeItem[] {
    const activeId = this.store.getActiveId();
    const sessionItems = this.store
      .getSessions()
      .map((session) => new SessionTreeItem(session, session.id === activeId));
    if (!this.tmuxAvailable) {
      return sessionItems;
    }
    const defaultAgentId = getDefaultAgentId();
    const newSessionItems = getAgentDefinitions().map(
      (agent) => new NewSessionTreeItem(agent, agent.id === defaultAgentId)
    );
    if (sessionItems.length === 0 || newSessionItems.length === 0) {
      return [...sessionItems, ...newSessionItems];
    }
    return [...sessionItems, new SeparatorTreeItem(), ...newSessionItems];
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }
}
