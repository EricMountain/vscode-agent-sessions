import { execFile } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { AgentDefinition } from "../types";

export const SOCKET_NAME = "agent-sessions";
const FIELD_SEP = "\x1f";

// Applied only when this invocation is the one that boots the tmux server
// (tmux ignores -f for an already-running server), so every session gets a
// consistent baseline without a separate configuration RPC.
//
// remain-on-exit is load-bearing: without it a session whose command exits
// immediately (bad command, wrong args) destroys itself before we can read
// back its metadata or surface the failure, and a fast-exiting agent races
// the `set-option` calls that tag a freshly created session.
function bootstrapConfig(focusEvents: boolean, mouse: boolean): string {
  return [
    "set-option -g status off",
    "set-option -g history-limit 10000",
    "set-option -g remain-on-exit on",
    `set-option -g focus-events ${focusEvents ? "on" : "off"}`,
    `set-option -g mouse ${mouse ? "on" : "off"}`,
    "",
  ].join("\n");
}

export interface TmuxSessionInfo {
  tmuxName: string;
  id: string;
  agentId: string;
  workspace: string;
  dead: boolean;
  exitCode: number | undefined;
  title: string;
  created: number;
  // Unix seconds the pane died, from tmux's own `pane_dead_time`; undefined
  // if alive or if the running tmux version doesn't report it.
  deadAt: number | undefined;
}

function execFileAsync(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// tmux passes shell-command to `$SHELL -c`, so build a single safely-quoted string.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// tmux's wording for "nobody has ever started a server on this socket" varies
// by version/platform, but always looks like one of these two - anything else
// (binary missing, PATH broken, permission denied, ...) is a real failure the
// caller needs to know about rather than silently treat as "zero sessions".
function isNoServerError(error: unknown): boolean {
  const stderr = (error as { stderr?: string } | undefined)?.stderr ?? "";
  return /no server running on|error connecting to/i.test(stderr);
}

export class TmuxServer {
  private readonly configPath: string;

  constructor(private tmuxPath: string, storageDir: string, focusEvents: boolean, mouse: boolean) {
    fs.mkdirSync(storageDir, { recursive: true });
    this.configPath = path.join(storageDir, "tmux.conf");
    fs.writeFileSync(this.configPath, bootstrapConfig(focusEvents, mouse), "utf8");
  }

  private run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(this.tmuxPath, ["-L", SOCKET_NAME, "-f", this.configPath, ...args]);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.tmuxPath, ["-V"]);
      return true;
    } catch {
      return false;
    }
  }

  async createSession(
    agent: AgentDefinition,
    cwd: string,
    workspaceKey: string,
    cols: number,
    rows: number
  ): Promise<{ id: string; tmuxName: string }> {
    const id = crypto.randomBytes(6).toString("hex");
    const tmuxName = `ag_${id}`;
    const commandLine = [agent.command, ...(agent.args ?? [])].map(shellQuote).join(" ");

    const args = ["new-session", "-d", "-s", tmuxName, "-c", cwd, "-x", String(cols), "-y", String(rows)];
    if (agent.env) {
      for (const [key, value] of Object.entries(agent.env)) {
        args.push("-e", `${key}=${value}`);
      }
    }
    args.push("--", commandLine);
    await this.run(args);
    await this.run(["set-option", "-t", tmuxName, "@agentId", agent.id]);
    await this.run(["set-option", "-t", tmuxName, "@workspace", workspaceKey]);
    return { id, tmuxName };
  }

  async listSessions(workspaceKey?: string): Promise<TmuxSessionInfo[]> {
    const format = [
      "#{session_name}",
      "#{@agentId}",
      "#{@workspace}",
      "#{pane_dead}",
      "#{pane_dead_status}",
      "#{pane_title}",
      "#{session_created}",
      "#{pane_dead_time}",
    ].join(FIELD_SEP);
    let stdout: string;
    try {
      ({ stdout } = await this.run(["list-sessions", "-F", format]));
    } catch (error) {
      if (isNoServerError(error)) {
        return [];
      }
      throw error;
    }
    const sessions: TmuxSessionInfo[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const [tmuxName, agentId, workspace, deadFlag, exitStatus, title, created, deadTime] = line.split(FIELD_SEP);
      if (!tmuxName?.startsWith("ag_")) {
        continue;
      }
      if (workspaceKey && workspace !== workspaceKey) {
        continue;
      }
      const dead = deadFlag === "1";
      sessions.push({
        tmuxName,
        id: tmuxName.slice("ag_".length),
        agentId: agentId ?? "",
        workspace: workspace ?? "",
        dead,
        exitCode: dead && exitStatus !== "" ? Number(exitStatus) : undefined,
        title: title ?? "",
        created: Number(created) || 0,
        deadAt: dead && deadTime ? Number(deadTime) || undefined : undefined,
      });
    }
    sessions.sort((a, b) => a.created - b.created);
    return sessions;
  }

  async killSession(tmuxName: string): Promise<void> {
    try {
      await this.run(["kill-session", "-t", tmuxName]);
    } catch {
      // Already gone.
    }
  }
}
