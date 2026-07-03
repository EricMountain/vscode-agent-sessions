import * as os from "os";

// Generous cap purely to guard against a pathological OSC title flooding the
// tree with an enormous string; actual visual truncation/ellipsis is handled
// responsively by VS Code's own tree view based on the view's width.
const MAX_LABEL_LENGTH = 200;

// tmux's pane_title defaults to the machine hostname until the running
// program emits an OSC title escape sequence. A freshly spawned agent CLI
// often hasn't done that yet, so the "terminal title" we'd otherwise trust
// is really just this unset default rather than a real title.
const HOSTNAME = os.hostname();
const SHORT_HOSTNAME = HOSTNAME.split(".")[0];

function isDefaultHostnameTitle(title: string): boolean {
  return title === HOSTNAME || title === SHORT_HOSTNAME;
}

// Strips ASCII control characters (including ESC-driven sequences already
// stripped by the pty layer) and common spinner glyphs (Braille Patterns
// U+2800-U+28FF, Box Drawing U+2500-U+257F, Block Elements U+2580-U+259F)
// that busy CLI agents animate into their terminal title while "thinking".
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
const SPINNER_GLYPHS = /[⠀-⣿─-▟]/g;

export function sanitizeTitle(rawTitle: string | undefined): string {
  if (!rawTitle) {
    return "";
  }
  const cleaned = rawTitle
    .replace(CONTROL_CHARS, "")
    .replace(SPINNER_GLYPHS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= MAX_LABEL_LENGTH) {
    return cleaned;
  }
  return `${cleaned.slice(0, MAX_LABEL_LENGTH)}…`;
}

export function computeDisplayName(
  rawTitle: string | undefined,
  agentLabel: string,
  ordinal: number,
  followTerminalTitle: boolean
): string {
  if (followTerminalTitle) {
    const sanitized = sanitizeTitle(rawTitle);
    if (sanitized && !isDefaultHostnameTitle(sanitized)) {
      return sanitized;
    }
  }
  return `${agentLabel} ${ordinal}`;
}
