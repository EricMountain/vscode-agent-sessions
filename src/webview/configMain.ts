interface VsCodeApi {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

interface AgentDefinition {
  id: string;
  label: string;
  command: string;
  args?: string[];
  icon?: string;
  iconPath?: string;
  cwd?: string;
  env?: Record<string, string>;
}

interface AgentRow {
  id: string;
  label: string;
  command: string;
  argsText: string;
  icon: string;
  iconPath: string;
  iconPreview: string;
  cwd: string;
  envText: string;
}

function toRow(agent: AgentDefinition, iconPreview: string): AgentRow {
  return {
    id: agent.id,
    label: agent.label,
    command: agent.command,
    argsText: (agent.args ?? []).join("\n"),
    icon: agent.icon ?? "",
    iconPath: agent.iconPath ?? "",
    iconPreview,
    cwd: agent.cwd ?? "",
    envText: Object.entries(agent.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  };
}

function toDefinition(row: AgentRow): AgentDefinition {
  const args = row.argsText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const env: Record<string, string> = {};
  for (const line of row.envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  const def: AgentDefinition = { id: row.id.trim(), label: row.label.trim(), command: row.command.trim() };
  if (args.length > 0) {
    def.args = args;
  }
  if (row.icon.trim()) {
    def.icon = row.icon.trim();
  }
  if (row.iconPath.trim()) {
    def.iconPath = row.iconPath.trim();
  }
  if (row.cwd.trim()) {
    def.cwd = row.cwd.trim();
  }
  if (Object.keys(env).length > 0) {
    def.env = env;
  }
  return def;
}

let rows: AgentRow[] = [];
let defaultAgentId = "";

const root = document.getElementById("root")!;

function uniqueId(base: string): string {
  let candidate = base || "agent";
  let n = 2;
  const ids = new Set(rows.map((r) => r.id));
  while (ids.has(candidate)) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

function addAgent(): void {
  rows.push({
    id: uniqueId("agent"),
    label: "New Agent",
    command: "",
    argsText: "",
    icon: "",
    iconPath: "",
    iconPreview: "",
    cwd: "",
    envText: "",
  });
  render();
}

function removeAgent(index: number): void {
  const removedId = rows[index]?.id;
  rows.splice(index, 1);
  if (defaultAgentId === removedId) {
    defaultAgentId = rows[0]?.id ?? "";
  }
  render();
}

function moveAgent(index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= rows.length) {
    return;
  }
  const [row] = rows.splice(index, 1);
  rows.splice(target, 0, row);
  render();
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

function field(labelText: string, input: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.textContent = labelText;
  wrap.append(span, input);
  return wrap;
}

function textInput(value: string, onChange: (value: string) => void, placeholder = ""): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

function textArea(value: string, onChange: (value: string) => void, placeholder = ""): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.placeholder = placeholder;
  textarea.rows = 3;
  textarea.addEventListener("input", () => onChange(textarea.value));
  return textarea;
}

function iconPreviewElement(row: AgentRow): HTMLElement {
  if (row.iconPath.trim() && row.iconPreview) {
    const img = document.createElement("img");
    img.className = "icon-preview";
    img.src = row.iconPreview;
    img.alt = "";
    return img;
  }
  const span = document.createElement("span");
  span.className = `codicon codicon-${row.icon.trim() || "terminal"} icon-preview`;
  return span;
}

function render(): void {
  root.innerHTML = "";

  const header = document.createElement("div");
  header.className = "toolbar";
  header.append(
    button("Add Agent", addAgent),
    (() => {
      const btn = button("Reset to Defaults", () => {
        if (
          confirm(
            "Replace all agents with the built-in defaults (Claude Code, Codex, opencode, pi)? This discards unsaved edits."
          )
        ) {
          vscode.postMessage({ type: "resetDefaults" });
        }
      });
      btn.className = "secondary";
      return btn;
    })()
  );
  root.appendChild(header);

  const list = document.createElement("div");
  list.className = "agent-list";
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No agents configured. Add one to get started.";
    list.appendChild(empty);
  } else {
    rows.forEach((row, index) => list.appendChild(renderCard(row, index)));
  }
  root.appendChild(list);

  const footer = document.createElement("div");
  footer.className = "toolbar footer";
  footer.append(
    button("Save", save),
    (() => {
      const btn = button("Reload", () => vscode.postMessage({ type: "ready" }));
      btn.className = "secondary";
      return btn;
    })()
  );
  root.appendChild(footer);
}

function renderCard(row: AgentRow, index: number): HTMLElement {
  const card = document.createElement("div");
  card.className = "agent-card";

  const titleRow = document.createElement("div");
  titleRow.className = "card-title";

  const defaultLabel = document.createElement("label");
  defaultLabel.className = "default-radio";
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "defaultAgent";
  radio.checked = row.id === defaultAgentId;
  radio.addEventListener("change", () => {
    defaultAgentId = row.id;
    render();
  });
  defaultLabel.append(radio, document.createTextNode(" Default"));

  const spacer = document.createElement("div");
  spacer.className = "spacer";

  const upBtn = button("↑", () => moveAgent(index, -1));
  upBtn.disabled = index === 0;
  const downBtn = button("↓", () => moveAgent(index, 1));
  downBtn.disabled = index === rows.length - 1;
  const removeBtn = button("Remove", () => removeAgent(index));
  removeBtn.className = "danger";

  titleRow.append(defaultLabel, spacer, upBtn, downBtn, removeBtn);
  card.appendChild(titleRow);

  const grid = document.createElement("div");
  grid.className = "field-grid";

  grid.appendChild(
    field(
      "Id",
      textInput(row.id, (v) => (row.id = v))
    )
  );
  grid.appendChild(
    field(
      "Label",
      textInput(row.label, (v) => (row.label = v))
    )
  );
  grid.appendChild(
    field(
      "Command",
      textInput(row.command, (v) => (row.command = v), "e.g. claude")
    )
  );

  const iconInput = textInput(row.icon, (v) => {
    row.icon = v;
    preview.className = `codicon codicon-${v.trim() || "terminal"} icon-preview`;
  }, "e.g. terminal");
  const iconRow = document.createElement("div");
  iconRow.className = "icon-row";
  const preview = iconPreviewElement(row);
  iconRow.append(preview, iconInput);
  grid.appendChild(field("Icon (codicon id)", iconRow));

  const iconPathInput = textInput(row.iconPath, (v) => (row.iconPath = v), "Custom icon image (overrides codicon)");
  const browseIconBtn = button("Browse…", () => vscode.postMessage({ type: "pickIcon", index }));
  const iconPathWrap = document.createElement("div");
  iconPathWrap.className = "cwd-row";
  iconPathWrap.append(iconPathInput, browseIconBtn);
  grid.appendChild(field("Custom icon (svg/png)", iconPathWrap));

  const cwdInput = textInput(row.cwd, (v) => (row.cwd = v), "Defaults to workspace root");
  const browseBtn = button("Browse…", () => vscode.postMessage({ type: "pickCwd", index }));
  const cwdWrap = document.createElement("div");
  cwdWrap.className = "cwd-row";
  cwdWrap.append(cwdInput, browseBtn);
  grid.appendChild(field("Working directory", cwdWrap));

  grid.appendChild(
    field(
      "Args (one per line)",
      textArea(row.argsText, (v) => (row.argsText = v))
    )
  );
  grid.appendChild(
    field(
      "Environment (KEY=VALUE per line)",
      textArea(row.envText, (v) => (row.envText = v))
    )
  );

  card.appendChild(grid);
  return card;
}

function save(): void {
  vscode.postMessage({
    type: "save",
    agents: rows.map(toDefinition),
    defaultAgentId,
  });
}

window.addEventListener("message", (event) => {
  const message = event.data as {
    type: string;
    agents?: AgentDefinition[];
    defaultAgentId?: string;
    iconPreviews?: Record<string, string>;
    index?: number;
    cwd?: string;
    iconPath?: string;
    dataUri?: string;
  };
  switch (message.type) {
    case "load": {
      const previews = message.iconPreviews ?? {};
      rows = (message.agents ?? []).map((agent) => toRow(agent, previews[agent.id] ?? ""));
      defaultAgentId = message.defaultAgentId ?? rows[0]?.id ?? "";
      render();
      break;
    }
    case "cwdPicked":
      if (typeof message.index === "number" && rows[message.index] && message.cwd) {
        rows[message.index].cwd = message.cwd;
        render();
      }
      break;
    case "iconPicked":
      if (typeof message.index === "number" && rows[message.index] && message.iconPath) {
        rows[message.index].iconPath = message.iconPath;
        rows[message.index].iconPreview = message.dataUri ?? "";
        render();
      }
      break;
  }
});

vscode.postMessage({ type: "ready" });
