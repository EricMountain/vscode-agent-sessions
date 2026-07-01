const MAX_LABEL_LENGTH = 40;

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
  return rawTitle
    .replace(CONTROL_CHARS, "")
    .replace(SPINNER_GLYPHS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL_LENGTH);
}

export function computeDisplayName(
  rawTitle: string | undefined,
  agentLabel: string,
  ordinal: number,
  followTerminalTitle: boolean
): string {
  if (followTerminalTitle) {
    const sanitized = sanitizeTitle(rawTitle);
    if (sanitized) {
      return sanitized;
    }
  }
  return `${agentLabel} ${ordinal}`;
}
