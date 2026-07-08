// Some agents (e.g. Claude Code) redraw an animated status line several
// times a second while processing a prompt. Each redraw is bracketed in a
// real DECTCEM cursor-hide/cursor-show pair (`\x1b[?25l` ... `\x1b[?25h`),
// which is standard practice to avoid the cursor visibly jumping mid-repaint
// - but forwarded straight through to a terminal renderer, that pair fires
// at the redraw's frame rate (measured ~7-8 times/sec for Claude Code's
// spinner), which reads as the terminal cursor flashing rapidly rather than
// its normal, much slower blink.
//
// This class sits between the raw pty byte stream and whatever renders it.
// It passes all bytes through unchanged and in real time, except for `?25h`
// /`?25l` sequences: those are held back and coalesced, so a burst of rapid
// toggles collapses into a single change emitted after `delayMs` of quiet -
// the settled end state, not every intermediate flicker.
export class CursorVisibilityCoalescer {
  private static readonly TOGGLE_RE = /\x1b\[\?25[hl]/g;
  // Longest first: the first one that matches the tail of the buffer wins.
  private static readonly PARTIAL_PREFIXES = ["\x1b[?25", "\x1b[?2", "\x1b[?", "\x1b[", "\x1b"];

  private carry = "";
  private pending: "h" | "l" | undefined;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly delayMs: number,
    private readonly isEnabled: () => boolean,
    private readonly emit: (text: string) => void
  ) {}

  push(chunk: string): void {
    if (!this.isEnabled()) {
      // Coalescing was just turned off (or never on) - forget any buffered
      // state from a previous enabled run and pass this chunk straight
      // through unmodified.
      this.reset();
      if (chunk.length > 0) {
        this.emit(chunk);
      }
      return;
    }

    let text = this.carry + chunk;
    this.carry = "";

    let sawToggle = false;
    let lastDirection: "h" | "l" | undefined;
    text = text.replace(CursorVisibilityCoalescer.TOGGLE_RE, (match) => {
      sawToggle = true;
      lastDirection = match.endsWith("h") ? "h" : "l";
      return "";
    });

    // A toggle sequence split across two pty reads would otherwise leak its
    // prefix through as literal text on this chunk and lose the rest.
    for (const prefix of CursorVisibilityCoalescer.PARTIAL_PREFIXES) {
      if (text.endsWith(prefix)) {
        this.carry = prefix;
        text = text.slice(0, -prefix.length);
        break;
      }
    }

    if (text.length > 0) {
      this.emit(text);
    }

    if (sawToggle && lastDirection) {
      this.pending = lastDirection;
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
      }
      this.flushTimer = setTimeout(() => this.flush(), this.delayMs);
    }
  }

  private flush(): void {
    this.flushTimer = undefined;
    if (this.pending) {
      const sequence = this.pending === "h" ? "\x1b[?25h" : "\x1b[?25l";
      this.pending = undefined;
      this.emit(sequence);
    }
  }

  private reset(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.pending = undefined;
    this.carry = "";
  }

  dispose(): void {
    this.reset();
  }
}
