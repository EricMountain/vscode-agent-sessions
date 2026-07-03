interface VsCodeApi {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

interface AgentButtonSummary {
  id: string;
  label: string;
  icon?: string;
  iconDataUri?: string;
}

const root = document.getElementById("root")!;

function iconElement(agent: AgentButtonSummary): HTMLElement {
  if (agent.iconDataUri) {
    const img = document.createElement("img");
    img.className = "agent-icon";
    img.src = agent.iconDataUri;
    img.alt = "";
    return img;
  }
  const span = document.createElement("span");
  span.className = `codicon codicon-${agent.icon?.trim() || "terminal"} agent-icon`;
  return span;
}

function render(agents: AgentButtonSummary[], defaultAgentId: string): void {
  root.innerHTML = "";

  if (agents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No agents configured.";
    root.appendChild(empty);
  } else {
    const row = document.createElement("div");
    row.className = "button-row";
    for (const agent of agents) {
      const btn = document.createElement("button");
      btn.className = "agent-button" + (agent.id === defaultAgentId ? " is-default" : "");
      btn.title = agent.id === defaultAgentId ? `${agent.label} (default)` : agent.label;
      btn.appendChild(iconElement(agent));
      const label = document.createElement("span");
      label.textContent = agent.label;
      btn.appendChild(label);
      btn.addEventListener("click", () => {
        vscode.postMessage({ type: "newSession", agentId: agent.id });
      });
      row.appendChild(btn);
    }
    root.appendChild(row);
  }

  const configureLink = document.createElement("a");
  configureLink.href = "#";
  configureLink.className = "configure-link";
  configureLink.textContent = "Configure agents…";
  configureLink.addEventListener("click", (event) => {
    event.preventDefault();
    vscode.postMessage({ type: "configureAgents" });
  });
  root.appendChild(configureLink);
}

window.addEventListener("message", (event) => {
  const message = event.data as { type: string; agents?: AgentButtonSummary[]; defaultAgentId?: string };
  if (message.type === "agents") {
    render(message.agents ?? [], message.defaultAgentId ?? "");
  }
});

vscode.postMessage({ type: "ready" });
