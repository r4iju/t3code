/**
 * Extracts http(s) URLs from the raw PTY byte stream so the terminal panel can
 * offer them as tappable links. The native Ghostty surface renders text on the
 * GPU with no tap-to-open support, so links are surfaced in a chip bar instead.
 *
 * Working on the logical stream (rather than the rendered grid) also lets us
 * recover URLs that TUIs hard-wrap to the terminal width — critical on phones
 * where OAuth login URLs span many rows.
 */

/** Only the tail of the buffer is scanned; login/auth URLs are always recent. */
export const TERMINAL_LINK_SCAN_WINDOW_BYTES = 16_384;

export const TERMINAL_LINK_MAX_RESULTS = 3;

/* eslint-disable no-control-regex -- ANSI escape parsing matches ESC/BEL bytes by design */
const OSC_HYPERLINK_PATTERN = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const OSC_PATTERN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const CSI_PATTERN = /\x1b\[[0-9;:?]*[ -/]*[@-~]/g;
const ESC_CHARSET_PATTERN = /\x1b[()*+][0-9A-Za-z]/g;
const ESC_SINGLE_PATTERN = /\x1b[@-Z\\-_]/g;
// Everything below 0x20 except \n and \r, plus DEL. \r\n is normalized to \n
// here; lone \r (line overwrite) is resolved per line during extraction.
const CONTROL_CHAR_PATTERN = /[\x00-\x09\x0b-\x0c\x0e-\x1f\x7f]/g;
/* eslint-enable no-control-regex */

const URL_PATTERN = /https?:\/\/[^\s"'`<>]+/g;
const URL_SCHEME_PATTERN = /^https?:\/\//;
const URL_CONTINUATION_PATTERN = /^[^\s"'`<>]+/;
const TRAILING_PUNCTUATION_PATTERN = /[.,;!?…]+$/;

/** Mirrors the web terminal's link cleanup (apps/web/src/terminal-links.ts). */
function trimClosingDelimiters(value: string): string {
  let output = value.replace(TRAILING_PUNCTUATION_PATTERN, "");

  const trimUnbalanced = (open: string, close: string) => {
    while (output.endsWith(close)) {
      const opens = output.split(open).length - 1;
      const closes = output.split(close).length - 1;
      if (opens >= closes) return;
      output = output.slice(0, -1);
    }
  };

  trimUnbalanced("(", ")");
  trimUnbalanced("[", "]");
  trimUnbalanced("{", "}");
  return output;
}

function stripAnsi(raw: string): string {
  return (
    raw
      // Inline OSC 8 hyperlink targets where the anchor starts, so they rank
      // by buffer position like plain-text URLs.
      .replace(OSC_HYPERLINK_PATTERN, (_sequence, uri: string) =>
        URL_SCHEME_PATTERN.test(uri) ? ` ${uri} ` : "",
      )
      .replace(OSC_PATTERN, "")
      .replace(CSI_PATTERN, "")
      .replace(ESC_CHARSET_PATTERN, "")
      .replace(ESC_SINGLE_PATTERN, "")
      .replace(/\r\n/g, "\n")
      .replace(CONTROL_CHAR_PATTERN, "")
  );
}

/**
 * A lone \r rewinds the cursor to overwrite the line (spinners, progress
 * bars); keep only the final paint so truncated intermediates never surface
 * as stale links.
 */
function resolveLineOverwrites(line: string): string {
  return line.slice(line.lastIndexOf("\r") + 1);
}

/**
 * TUIs (e.g. Ink) wrap output to the terminal width themselves, so a URL cut
 * by wrapping fills its whole row and continues as a bare token on the next
 * line. Rows narrower than this are treated as intentional line ends — phone
 * terminals report ~45+ columns at the default font size, and requiring it
 * avoids gluing following prose onto short URLs that merely end a line.
 */
const MIN_WRAP_JOIN_WIDTH = 40;

function joinWrappedUrl(
  lines: ReadonlyArray<string>,
  lineIndex: number,
  matchText: string,
  matchEnd: number,
): string {
  let url = matchText;
  let index = lineIndex;
  let cutByWrap = matchEnd === lines[index]?.length;

  while (cutByWrap && (lines[index]?.length ?? 0) >= MIN_WRAP_JOIN_WIDTH) {
    const nextLine = lines[index + 1];
    if (nextLine === undefined) break;
    const continuation = URL_CONTINUATION_PATTERN.exec(nextLine)?.[0];
    // A wrap continuation is the line's only content; anything after a space
    // is prose that happens to follow the URL. A token that starts its own
    // scheme is a separate adjacent URL, never a continuation.
    if (continuation === undefined || continuation !== nextLine.trimEnd()) break;
    if (URL_SCHEME_PATTERN.test(continuation)) break;

    url += continuation;
    index += 1;
    cutByWrap = continuation.length === nextLine.length;
  }

  return url;
}

/**
 * Returns unique http(s) URLs found near the end of the terminal buffer, most
 * recent first. Wrapped URLs are reassembled and ANSI styling is ignored.
 */
export function extractTerminalBufferLinks(buffer: string): string[] {
  if (buffer.length === 0) return [];

  let window = buffer.slice(-TERMINAL_LINK_SCAN_WINDOW_BYTES);
  if (window.length < buffer.length) {
    // Drop the possibly mid-sequence/mid-URL first line of the window.
    const firstNewline = window.indexOf("\n");
    if (firstNewline >= 0) {
      window = window.slice(firstNewline + 1);
    }
  }

  const text = stripAnsi(window);
  const lines = text.split("\n").map(resolveLineOverwrites);

  const ordered: string[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    URL_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(URL_PATTERN)) {
      const start = match.index ?? -1;
      if (start < 0) continue;
      const joined = joinWrappedUrl(lines, lineIndex, match[0], start + match[0].length);
      const trimmed = trimClosingDelimiters(joined);
      if (trimmed.length > "https://".length) {
        ordered.push(trimmed);
      }
    }
  }

  // Keep the last occurrence of each URL, most recent first.
  const deduped: string[] = [];
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const url = ordered[index];
    if (url === undefined || deduped.includes(url)) continue;
    deduped.push(url);
  }

  return deduped.slice(0, TERMINAL_LINK_MAX_RESULTS);
}

/** Compact chip label: host plus a hint that a path/query follows. */
export function terminalLinkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const hasTail =
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search !== "" ||
      parsed.hash !== "";
    return hasTail ? `${parsed.host}/…` : parsed.host;
  } catch {
    return url.length > 40 ? `${url.slice(0, 39)}…` : url;
  }
}
