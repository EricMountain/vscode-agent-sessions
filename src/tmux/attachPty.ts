import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import * as vscode from "vscode";
import { SOCKET_NAME } from "./tmuxServer";

export class AttachPty implements vscode.Disposable {
  private readonly proc: pty.IPty;
  private readonly onDataEmitter = new vscode.EventEmitter<string>();
  private readonly onExitEmitter = new vscode.EventEmitter<void>();
  readonly onData = this.onDataEmitter.event;
  readonly onExit = this.onExitEmitter.event;
  private disposed = false;

  constructor(tmuxPath: string, tmuxName: string, cols: number, rows: number) {
    this.proc = pty.spawn(tmuxPath, ["-L", SOCKET_NAME, "attach-session", "-t", tmuxName], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env.HOME ?? process.cwd(),
      env: process.env as Record<string, string>,
    });
    this.proc.onData((data) => this.onDataEmitter.fire(data));
    this.proc.onExit(() => {
      if (!this.disposed) {
        this.onExitEmitter.fire();
      }
    });
  }

  write(data: string): void {
    this.proc.write(data);
  }

  resize(cols: number, rows: number): void {
    if (cols > 0 && rows > 0) {
      this.proc.resize(cols, rows);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.onDataEmitter.dispose();
    try {
      this.proc.kill();
    } catch {
      // Already exited.
    }
    this.onExitEmitter.dispose();
  }
}
