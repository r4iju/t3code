/**
 * Turns assistant Markdown into prose a speech service should read. Both the
 * environment (to synthesize) and the clients (to decide whether a message has
 * anything to read) run this, so they always agree on the spoken text.
 *
 * Preparing happens in two steps. `prepareSpeechBlocks` is backend-neutral: it
 * flattens Markdown and rewrites the tokens every speech model mispronounces.
 * `renderSpeechText` then adds the inline markers of the configured dialect,
 * which only some endpoints understand.
 */
import type { SpeechDialect } from "@t3tools/contracts";

/**
 * Past either limit a table is announced by its shape instead of read. Speaking
 * every cell of a long table is a recital nobody listens to, and unlike a
 * screen reader there is no way to skip ahead.
 */
export const MAX_SPOKEN_TABLE_ROWS = 6;
export const MAX_SPOKEN_TABLE_COLUMNS = 4;

const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;
const TABLE_LINE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_LINE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HEADING_LINE = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/;
const BLOCKQUOTE_MARKER = /^\s*(?:>\s?)+/;
const HORIZONTAL_RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/;
const INDENTED_CODE_LINE = /^(?: {4}|\t)/;
const TERMINAL_PUNCTUATION = /[.!?:;,]$/;
// Only the directives Codex emits; a generic colon rule would eat "10:30" or "re:build".
const CODEX_DIRECTIVE =
  /:{1,3}(?:codex-file-citation|artifact-template)(?:\[([^\]]*)\])?(?:\{[^}]*\})?/g;

// A ticket key reads as a word ("SUP-1402" becomes "sup fourteen oh two")
// unless its letters are separated.
const TICKET_ID = /\b([A-Z]{2,6})-(\d{1,6})\b/g;
// Lowercase hex with at least one digit and one letter: a commit hash, which a
// model otherwise reads as a mangled word. Plain numbers and words are excluded.
const HEX_HASH = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;
// The leading group keeps a URL's own path from matching after its "//".
const PATH_LIKE = /(^|[^/\w.-])([\w.-]+(?:\/[\w.-]+)+)/g;
const FILE_EXTENSION = /\.[A-Za-z]{1,5}$/;
const ISSUE_NUMBER = /#(\d+)\b/g;
const VERSION_TAG = /\bv(\d+(?:\.\d+)+)\b/g;
// Three or more parts is a version or an address, never a decimal.
const DOTTED_NUMBER = /\b\d+(?:\.\d+){2,}\b/g;
/** Hashes are spoken in their short form; nobody dictates forty hex characters. */
const SPOKEN_HASH_CHARS = 8;

function spell(token: string): string {
  return token.split("").join(" ");
}

/** Only the file name is worth hearing; the directories are a recital of slashes. */
function spokenPath(path: string): string {
  const parts = path.split("/");
  const last = parts[parts.length - 1] ?? path;
  return parts.length > 2 || FILE_EXTENSION.test(last) ? last : path;
}

/**
 * Rewrites what speech models reliably get wrong about the text agents produce:
 * identifiers, hashes, paths and versions. Every rule is plain prose in, plain
 * prose out, so it applies whichever endpoint is configured.
 */
export function normalizeSpokenText(text: string): string {
  return text
    .replace(VERSION_TAG, (_match, digits: string) => `version ${digits}`)
    .replace(DOTTED_NUMBER, (match) => match.split(".").join(" point "))
    .replace(PATH_LIKE, (_match, before: string, path: string) => `${before}${spokenPath(path)}`)
    .replace(
      TICKET_ID,
      (_match, letters: string, digits: string) => `${letters.split("").join("-")} ${digits}`,
    )
    .replace(HEX_HASH, (match) => spell(match.slice(0, SPOKEN_HASH_CHARS)))
    .replace(ISSUE_NUMBER, (_match, digits: string) => `number ${digits}`);
}

function stripInlineMarkup(line: string): string {
  return normalizeSpokenText(
    line
      .replace(CODEX_DIRECTIVE, (_match, label: string | undefined) => label ?? "")
      // Images read as their alt text; links as their label.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      // A code span is the one place we know a token is an identifier, so its
      // word separators become spoken word breaks.
      .replace(/`([^`]*)`/g, (_match, code: string) => code.replace(/_/g, " "))
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?=[^\w*]|$)/g, "$1$2")
      // Underscore emphasis only at word edges, so snake_case identifiers survive.
      .replace(/(^|[^\w])_([^_\s][^_]*?)_(?=[^\w]|$)/g, "$1$2")
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function ensureSentenceEnd(text: string): string {
  return TERMINAL_PUNCTUATION.test(text) ? text : `${text}.`;
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripInlineMarkup(cell));
}

/**
 * Reads a table the way a screen reader does: announce what the columns are,
 * then speak each row. Cells keep their column name because position is
 * unrecoverable by ear, except in a two-column table where the row is a pair
 * and "before: flat" says it all.
 */
function speakTable(lines: readonly string[]): SpeechBlock[] {
  const rows = lines
    .filter((line) => !TABLE_SEPARATOR_LINE.test(line))
    .map(tableCells)
    .filter((cells) => cells.some((cell) => cell.length > 0));
  const header = rows[0];
  if (header === undefined) return [];
  const body = rows.slice(1);
  const columns = header.filter((cell) => cell.length > 0).join(", ");
  if (body.length === 0) {
    return [{ kind: "paragraph", text: ensureSentenceEnd(`Table. Columns: ${columns}`) }];
  }
  if (body.length > MAX_SPOKEN_TABLE_ROWS || header.length > MAX_SPOKEN_TABLE_COLUMNS) {
    return [
      {
        kind: "paragraph",
        text: ensureSentenceEnd(
          `Table with ${body.length} ${body.length === 1 ? "row" : "rows"}. Columns: ${columns}`,
        ),
      },
    ];
  }
  const blocks: SpeechBlock[] = [
    { kind: "paragraph", text: ensureSentenceEnd(`Table. Columns: ${columns}`) },
  ];
  for (const cells of body) {
    const subject = cells[0] ?? "";
    const rest = cells.slice(1);
    const text =
      header.length <= 2
        ? [subject, rest[0] ?? ""].filter((part) => part.length > 0).join(": ")
        : [
            subject,
            ...rest.map((cell, index) => {
              const label = header[index + 1] ?? "";
              if (cell.length === 0) return "";
              return label.length > 0 ? `${label}: ${cell}` : cell;
            }),
          ]
            .filter((part) => part.length > 0)
            .join(". ");
    // Each row is its own block, so a dialect that pauses puts a beat between them.
    if (text.length > 0) blocks.push({ kind: "list-item", text: ensureSentenceEnd(text) });
  }
  return blocks;
}

/**
 * A flattened piece of a message. The kind survives Markdown so a dialect that
 * can pause knows a heading deserves a longer beat than the next bullet.
 */
export type SpeechBlockKind = "heading" | "list-item" | "paragraph";

export type SpeechBlock = {
  readonly kind: SpeechBlockKind;
  readonly text: string;
};

/** Returns an empty array when nothing speakable remains. */
export function prepareSpeechBlocks(markdown: string): SpeechBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: SpeechBlock[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let inTable = false;
  let tableLines: string[] = [];
  let previousLineBlank = true;

  let currentIsListItem = false;

  const flush = () => {
    const text = current.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) {
      blocks.push(
        currentIsListItem
          ? { kind: "list-item", text: ensureSentenceEnd(text) }
          : { kind: "paragraph", text },
      );
    }
    current = [];
    currentIsListItem = false;
  };

  const closeTable = () => {
    if (!inTable) return;
    inTable = false;
    blocks.push(...speakTable(tableLines));
    tableLines = [];
  };

  for (const rawLine of lines) {
    if (fence) {
      const closing = FENCE_LINE.exec(rawLine)?.[1];
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = null;
      continue;
    }
    const fenceMatch = FENCE_LINE.exec(rawLine);
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1]!;
      previousLineBlank = true;
      continue;
    }

    if (TABLE_LINE.test(rawLine) || (rawLine.includes("|") && TABLE_SEPARATOR_LINE.test(rawLine))) {
      if (!inTable) {
        flush();
        inTable = true;
      }
      tableLines.push(rawLine);
      continue;
    }
    closeTable();

    if (rawLine.trim().length === 0 || HORIZONTAL_RULE.test(rawLine)) {
      flush();
      previousLineBlank = true;
      continue;
    }

    // An indented block after a blank line is code; directly under prose or a
    // list item it is a wrapped continuation line.
    if (INDENTED_CODE_LINE.test(rawLine) && previousLineBlank) {
      continue;
    }
    previousLineBlank = false;

    const heading = HEADING_LINE.exec(rawLine);
    if (heading) {
      flush();
      const text = stripInlineMarkup(heading[1] ?? "");
      if (text.length > 0) blocks.push({ kind: "heading", text: ensureSentenceEnd(text) });
      continue;
    }

    let line = rawLine.replace(BLOCKQUOTE_MARKER, "");
    const listMatch = LIST_MARKER.exec(line);
    if (listMatch) {
      // Each item is its own sentence; its wrapped continuation lines join it.
      flush();
      line = line.slice(listMatch[0].length);
      const text = stripInlineMarkup(line);
      if (text.length > 0) current.push(text);
      currentIsListItem = true;
      continue;
    }

    // Only an indented line continues a list item; anything else starts fresh.
    if (currentIsListItem && !/^\s/.test(rawLine)) flush();
    const text = stripInlineMarkup(line);
    if (text.length > 0) current.push(text);
  }
  closeTable();
  flush();

  return blocks;
}

/** The plain reading of prepared blocks, with no dialect markers in it. */
export function speechTextFromBlocks(blocks: readonly SpeechBlock[]): string {
  return blocks.map((block) => block.text).join("\n\n");
}

/** Returns "" when nothing speakable remains, which is how callers hide the control. */
export function prepareSpeechText(markdown: string): string {
  return speechTextFromBlocks(prepareSpeechBlocks(markdown));
}

// Han, kana, Hangul and the compatibility blocks, then the punctuation that
// belongs to a run it follows. Ranges rather than Unicode property escapes,
// which not every client runtime compiles.
const CJK_LETTER = "\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF";
const CJK_TRAILING = "\\u3000-\\u303F\\uFF01-\\uFF65";
const CJK_RUN = new RegExp(`[${CJK_LETTER}][${CJK_LETTER}${CJK_TRAILING}]*`, "g");

/** Seconds of silence after a block. A heading introduces what follows, so it gets the longer beat. */
const BLOCK_PAUSE_SECONDS: Record<SpeechBlockKind, number> = {
  heading: 0.6,
  "list-item": 0.35,
  paragraph: 0.35,
};

export type SpeechRenderOptions = {
  readonly dialect: SpeechDialect;
  /** The request's own voice, which each routed run has to hand control back to. */
  readonly voice: string;
  /** Empty leaves CJK runs to the main voice. */
  readonly cjkVoice: string;
};

/**
 * Joins prepared blocks into the text one endpoint should receive.
 *
 * The plain dialect is the blocks themselves: paragraph breaks carry no meaning
 * to a speech model, so structure is simply lost, and a message reads as one
 * flat run. Kokoro understands two inline markers, which buys back the pause
 * between a heading and its bullets and lets a Japanese or Chinese run be
 * spoken by a voice whose language pipeline can actually read it.
 */
export function renderSpeechText(
  blocks: readonly SpeechBlock[],
  options: SpeechRenderOptions,
): string {
  if (options.dialect !== "kokoro") return speechTextFromBlocks(blocks);
  const cjkVoice = options.cjkVoice.trim();
  const voice = options.voice.trim();
  const routed =
    cjkVoice.length > 0 && voice.length > 0
      ? (text: string) =>
          text.replace(CJK_RUN, (run) => `[voice:${cjkVoice}]${run}[voice:${voice}]`)
      : (text: string) => text;
  const last = blocks.length - 1;
  return blocks
    .map((block, index) => {
      const text = routed(block.text);
      return index === last ? text : `${text} [pause:${BLOCK_PAUSE_SECONDS[block.kind]}s]`;
    })
    .join("\n\n");
}

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/**
 * Characters in a message's first segment. Each later segment may be twice the
 * one before it, up to the per-request ceiling: the first words arrive within a
 * couple of seconds, and a speech service that runs a few times faster than
 * real time stays ahead of playback from then on.
 */
export const SPEECH_FIRST_SEGMENT_CHARS = 200;

/**
 * A sentence over the limit breaks at whitespace; a single word over the limit
 * is the only thing that ever splits mid-word.
 */
function paragraphSentences(paragraph: string, maxChars: number): string[] {
  const sentences: string[] = [];
  for (const sentence of paragraph.split(SENTENCE_BOUNDARY)) {
    let rest = sentence;
    while (rest.length > maxChars) {
      const cut = rest.lastIndexOf(" ", maxChars);
      const at = cut > 0 ? cut : maxChars;
      sentences.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest.length > 0) sentences.push(rest);
  }
  return sentences;
}

/**
 * Splits prepared text into the segments an environment synthesizes one call
 * at a time. Segments end on sentence boundaries and keep paragraph breaks
 * inside them; their size starts at `SPEECH_FIRST_SEGMENT_CHARS` and doubles
 * until it reaches `maxChars`.
 */
export function splitSpeechSegments(text: string, maxChars: number): string[] {
  if (maxChars < 1) throw new RangeError("maxChars must be at least 1");
  const segments: string[] = [];
  let target = Math.min(SPEECH_FIRST_SEGMENT_CHARS, maxChars);
  let buffer = "";
  const close = () => {
    if (buffer.length === 0) return;
    segments.push(buffer);
    buffer = "";
    target = Math.min(target * 2, maxChars);
  };

  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) continue;
    let joiner = "\n\n";
    for (const sentence of paragraphSentences(trimmed, maxChars)) {
      if (buffer.length === 0) {
        buffer = sentence;
      } else if (buffer.length + joiner.length + sentence.length <= target) {
        buffer = `${buffer}${joiner}${sentence}`;
      } else {
        close();
        buffer = sentence;
      }
      joiner = " ";
    }
  }
  close();
  return segments;
}
