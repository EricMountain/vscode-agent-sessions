import * as vscode from "vscode";
import { getAgentDefinition } from "./agentRegistry";
import { SessionStore } from "./sessionStore";
import { SessionState } from "./types";

export class SessionTreeItem extends vscode.TreeItem {
  constructor(readonly session: SessionState, isActive: boolean) {
    super(session.displayName, vscode.TreeItemCollapsibleState.None);
    this.id = session.id;
    this.contextValue = "session";
    this.description = session.status === "exited" ? "exited" : isActive ? "$(circle-small-filled)" : undefined;
    this.tooltip = session.title || session.displayName;
    const agent = getAgentDefinition(session.agentId);
    this.iconPath = new vscode.ThemeIcon(agent?.icon ?? "terminal");
    this.command = {
      command: "agentSessions.selectSession",
      title: "Open Agent Session",
      arguments: [session.id],
    };
  }
}

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly store: SessionStore) {
    this.store.onDidChangeSessions(() => this.onDidChangeTreeDataEmitter.fire());
    this.store.onDidChangeActive(() => this.onDidChangeTreeDataEmitter.fire());
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(): undefined {
    // Flat list: every session is a root element.
    return undefined;
  }

  getChildren(): SessionTreeItem[] {
    const activeId = this.store.getActiveId();
    return this.store.getSessions().map((session) => new SessionTreeItem(session, session.id === activeId));
  }
}
