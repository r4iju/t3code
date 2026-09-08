/**
 * Turns assistant Markdown into prose a speech service should read. Both the
 * environment (to synthesize) and the clients (to decide whether a message has
 * anything to read) run this, so they always agree on the spoken text.
 */

export const SPEECH_TABLE_OMITTED_NOTE = "Table omitted.";

const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;
const TABLE_LINE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_LINE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HEADING_LINE = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/;
const BLOCKQUOTE_MARKER = /^\s*(?:>\s?)+/;
const HORIZONTAL_RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/;
const TERMINAL_PUNCTUATION = /[.!?:;,]$/;
// Only the directives Codex emits; a generic colon rule would eat "10:30" or "re:build".
const CODEX_DIRECTIVE =
  /:{1,3}(?:codex-file-citation|artifact-template)(?:\[([^\]]*)\])?(?:\{[^}]*\})?/g;

function stripInlineMarkup(line: string): string {
  return (
    line
      .replace(CODEX_DIRECTIVE, (_match, label: string | undefined) => label ?? "")
      // Images read as their alt text; links as their label.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?=[^\w*]|$)/g, "$1$2")
      // Underscore emphasis only at word edges, so snake_case identifiers survive.
      .replace(/(^|[^\w])_([^_\s][^_]*?)_(?=[^\w]|$)/g, "$1$2")
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function ensureSentenceEnd(text: string): string {
  return TERMINAL_PUNCTUATION.test(text) ? text : `${text}.`;
}

/** Returns "" when nothing speakable remains, which is how callers hide the control. */
export function prepareSpeechText(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const paragraphs: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let inTable = false;

  const flush = () => {
    if (current.length === 0) return;
    const text = current.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) paragraphs.push(text);
    current = [];
  };

  for (const rawLine of lines) {
    if (fence) {
      if (FENCE_LINE.test(rawLine) && rawLine.trim().startsWith(fence[0]!)) fence = null;
      continue;
    }
    const fenceMatch = FENCE_LINE.exec(rawLine);
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1]!;
      continue;
    }

    if (TABLE_LINE.test(rawLine) || (rawLine.includes("|") && TABLE_SEPARATOR_LINE.test(rawLine))) {
      if (!inTable) {
        flush();
        paragraphs.push(SPEECH_TABLE_OMITTED_NOTE);
        inTable = true;
      }
      continue;
    }
    inTable = false;

    if (rawLine.trim().length === 0 || HORIZONTAL_RULE.test(rawLine)) {
      flush();
      continue;
    }

    const heading = HEADING_LINE.exec(rawLine);
    if (heading) {
      flush();
      const text = stripInlineMarkup(heading[1] ?? "");
      if (text.length > 0) paragraphs.push(ensureSentenceEnd(text));
      continue;
    }

    let line = rawLine.replace(BLOCKQUOTE_MARKER, "");
    const listMatch = LIST_MARKER.exec(line);
    if (listMatch) {
      flush();
      line = line.slice(listMatch[0].length);
      const text = stripInlineMarkup(line);
      if (text.length > 0) current.push(ensureSentenceEnd(text));
      flush();
      continue;
    }

    const text = stripInlineMarkup(line);
    if (text.length > 0) current.push(text);
  }
  flush();

  return paragraphs.join("\n\n");
}

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let buffer = "";
  const push = (piece: string) => {
    if (piece.length === 0) return;
    if (buffer.length === 0) {
      buffer = piece;
    } else if (buffer.length + 1 + piece.length <= maxChars) {
      buffer = `${buffer} ${piece}`;
    } else {
      pieces.push(buffer);
      buffer = piece;
    }
  };

  for (const sentence of paragraph.split(SENTENCE_BOUNDARY)) {
    if (sentence.length <= maxChars) {
      push(sentence);
      continue;
    }
    // A sentence over the limit breaks at whitespace; a single word over the
    // limit is the only thing that ever splits mid-word.
    let rest = sentence;
    while (rest.length > maxChars) {
      const cut = rest.lastIndexOf(" ", maxChars);
      const at = cut > 0 ? cut : maxChars;
      push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    push(rest);
  }
  if (buffer.length > 0) pieces.push(buffer);
  return pieces;
}

/** Chunks fall on paragraph, then sentence, then whitespace boundaries. */
export function splitSpeechText(text: string, maxChars: number): string[] {
  if (maxChars < 1) throw new RangeError("maxChars must be at least 1");
  const chunks: string[] = [];
  let buffer = "";

  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) continue;
    for (const piece of trimmed.length <= maxChars
      ? [trimmed]
      : splitLongParagraph(trimmed, maxChars)) {
      if (buffer.length === 0) {
        buffer = piece;
      } else if (buffer.length + 2 + piece.length <= maxChars) {
        buffer = `${buffer}\n\n${piece}`;
      } else {
        chunks.push(buffer);
        buffer = piece;
      }
    }
  }
  if (buffer.length > 0) chunks.push(buffer);
  return chunks;
}
