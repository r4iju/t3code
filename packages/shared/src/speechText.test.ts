import { describe, expect, it } from "vite-plus/test";

import {
  normalizeSpokenText,
  prepareSpeechBlocks,
  prepareSpeechText,
  renderSpeechText,
  SPEECH_FIRST_SEGMENT_CHARS,
  splitSpeechSegments,
} from "./speechText.ts";

describe("prepareSpeechText", () => {
  it("drops fenced code blocks and keeps the surrounding prose", () => {
    const markdown = [
      "Here is the fix.",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "Run it again.",
    ].join("\n");
    expect(prepareSpeechText(markdown)).toBe("Here is the fix.\n\nRun it again.");
  });

  it("reads a two-column table as pairs", () => {
    const markdown = [
      "Results:",
      "",
      "| name | value |",
      "| --- | --- |",
      "| a | 1 |",
      "| b | 2 |",
      "",
      "Done.",
    ].join("\n");
    expect(prepareSpeechText(markdown)).toBe(
      "Results:\n\nTable. Columns: name, value.\n\na: 1.\n\nb: 2.\n\nDone.",
    );
  });

  it("keeps the column with each cell once a table is wider than a pair", () => {
    const markdown = [
      "| file | change | lines |",
      "| --- | --- | --- |",
      "| `readAloud.ts` | rewritten | 40 |",
    ].join("\n");
    expect(prepareSpeechText(markdown)).toBe(
      "Table. Columns: file, change, lines.\n\nreadAloud.ts. change: rewritten. lines: 40.",
    );
  });

  it("announces the shape of a table too long to read", () => {
    const rows = Array.from({ length: 8 }, (_, index) => `| row ${index} | ${index} |`);
    const markdown = ["| name | value |", "| --- | --- |", ...rows].join("\n");
    expect(prepareSpeechText(markdown)).toBe("Table with 8 rows. Columns: name, value.");
  });

  it("announces the shape of a table too wide to read", () => {
    const markdown = [
      "| a | b | c | d | e |",
      "| --- | --- | --- | --- | --- |",
      "| 1 | 2 | 3 | 4 | 5 |",
    ].join("\n");
    expect(prepareSpeechText(markdown)).toBe("Table with 1 row. Columns: a, b, c, d, e.");
  });

  it("gives each table row its own block so a pausing dialect separates them", () => {
    const markdown = ["| step | result |", "| --- | --- |", "| before | flat |"].join("\n");
    expect(prepareSpeechBlocks(markdown)).toEqual([
      { kind: "paragraph", text: "Table. Columns: step, result." },
      { kind: "list-item", text: "before: flat." },
    ]);
  });

  it("keeps inline code and link labels as plain words", () => {
    expect(
      prepareSpeechText("Call `resolveAsset` from [the route](https://example.com/x) now."),
    ).toBe("Call resolveAsset from the route now.");
  });

  it("flattens headings, lists, quotes, and emphasis into sentences", () => {
    const markdown = [
      "## Summary",
      "",
      "- **First** item",
      "- Second item.",
      "1. Third _item_",
      "> quoted line",
      "",
      "---",
      "",
      "Plain *text* with snake_case_name kept.",
    ].join("\n");
    expect(prepareSpeechText(markdown)).toBe(
      [
        "Summary.",
        "First item.",
        "Second item.",
        "Third item.",
        "quoted line",
        "Plain text with snake_case_name kept.",
      ].join("\n\n"),
    );
  });

  it("strips Codex directives but keeps their labels", () => {
    const markdown = [
      'See :codex-file-citation[report.xlsx]{path="outputs/report.xlsx" purpose="output"} for details.',
      '::artifact-template{kind="spreadsheet"}',
      "Time is 10:30 and re:build stays.",
    ].join("\n");
    expect(prepareSpeechText(markdown)).toBe(
      "See report.xlsx for details. Time is 10:30 and re:build stays.",
    );
  });

  it("drops indented code blocks but keeps wrapped continuation lines", () => {
    const markdown = [
      "Run this:",
      "",
      "    npm install",
      "    npm test",
      "",
      "- a list item that",
      "    wraps onto an indented line.",
    ].join("\n");
    expect(prepareSpeechText(markdown)).toBe(
      "Run this:\n\na list item that wraps onto an indented line.",
    );
  });

  it("only closes a fence with one at least as long as the opener", () => {
    const markdown = ["````md", "```", "still code", "````", "After."].join("\n");
    expect(prepareSpeechText(markdown)).toBe("After.");
  });

  it("returns an empty string for code-only input", () => {
    expect(prepareSpeechText("```\nls -la\n```")).toBe("");
    expect(prepareSpeechText("   \n\n")).toBe("");
  });

  it("joins wrapped lines and normalizes whitespace", () => {
    expect(prepareSpeechText("one   two\nthree\r\n\r\nfour")).toBe("one two three\n\nfour");
  });
});

describe("splitSpeechSegments", () => {
  it("keeps short text as a single segment", () => {
    expect(splitSpeechSegments("Hello there.\n\nSecond paragraph.", 100)).toEqual([
      "Hello there.\n\nSecond paragraph.",
    ]);
  });

  it("keeps paragraph breaks inside a segment", () => {
    const text = "Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.";
    expect(splitSpeechSegments(text, 36)).toEqual([
      "Alpha paragraph.\n\nBeta paragraph.",
      "Gamma paragraph.",
    ]);
  });

  it("splits a long paragraph on sentence boundaries", () => {
    const text = "First sentence here. Second sentence here! Third one?";
    expect(splitSpeechSegments(text, 45)).toEqual([
      "First sentence here. Second sentence here!",
      "Third one?",
    ]);
  });

  it("never splits a word when a sentence exceeds the limit", () => {
    const text = "alpha beta gamma delta epsilon";
    const segments = splitSpeechSegments(text, 12);
    expect(segments).toEqual(["alpha beta", "gamma delta", "epsilon"]);
    for (const segment of segments) expect(segment.length).toBeLessThanOrEqual(12);
  });

  it("drops empty paragraphs", () => {
    expect(splitSpeechSegments("\n\n  \n\nonly", 10)).toEqual(["only"]);
  });

  it("starts small and doubles each segment up to the ceiling", () => {
    const sentence = "This sentence is exactly forty-nine chars long ok.";
    const text = Array.from({ length: 60 }, () => sentence).join(" ");
    const segments = splitSpeechSegments(text, 1000);
    expect(segments.join(" ")).toBe(text);
    expect(segments[0]!.length).toBeLessThanOrEqual(SPEECH_FIRST_SEGMENT_CHARS);
    expect(segments.length).toBeGreaterThan(4);
    let target = SPEECH_FIRST_SEGMENT_CHARS;
    for (const [index, segment] of segments.entries()) {
      expect(segment.length).toBeLessThanOrEqual(target);
      // Packed with whole sentences: one more would not have fit. The last
      // segment is whatever remains, so it may be short.
      if (index < segments.length - 1) {
        expect(segment.length + 1 + sentence.length).toBeGreaterThan(target);
      }
      target = Math.min(target * 2, 1000);
    }
  });

  it("never splits a sentence below the ceiling, even for the first segment", () => {
    const long = `${"word ".repeat(80)}end.`;
    expect(splitSpeechSegments(`${long} Short one.`, 4096)).toEqual([long, "Short one."]);
  });
});

describe("normalizeSpokenText", () => {
  it("separates the letters of a ticket key so it is not read as a word", () => {
    expect(normalizeSpokenText("Fixed SUP-1402 today.")).toBe("Fixed S-U-P 1402 today.");
  });

  it("spells a commit hash in its short form", () => {
    expect(normalizeSpokenText("pushed as cabc7d2b")).toBe("pushed as c a b c 7 d 2 b");
    expect(normalizeSpokenText("at 0f2c9ab5d3e77104ffaa")).toBe("at 0 f 2 c 9 a b 5");
  });

  it("leaves words and plain numbers alone", () => {
    expect(normalizeSpokenText("the facade decade 1402 3773")).toBe("the facade decade 1402 3773");
  });

  it("reads only the file name of a path", () => {
    expect(normalizeSpokenText("See apps/web/src/state/readAloud.ts now.")).toBe(
      "See readAloud.ts now.",
    );
    expect(normalizeSpokenText("in src/index.ts")).toBe("in index.ts");
  });

  it("keeps a bare slash pair that is not a path", () => {
    expect(normalizeSpokenText("and/or either")).toBe("and/or either");
  });

  it("does not mistake a URL's own path for a file path", () => {
    expect(normalizeSpokenText("open https://example.com/docs")).toBe(
      "open https://example.com/docs",
    );
  });

  it("says versions, dotted numbers and issue numbers the way they are meant", () => {
    expect(normalizeSpokenText("v0.0.40 fixes #16")).toBe(
      "version 0 point 0 point 40 fixes number 16",
    );
    expect(normalizeSpokenText("host 192.168.0.20")).toBe("host 192 point 168 point 0 point 20");
    expect(normalizeSpokenText("about 1.5 seconds")).toBe("about 1.5 seconds");
  });
});

describe("prepareSpeechBlocks", () => {
  it("keeps the kind of each flattened block", () => {
    const markdown = [
      "## What happens next",
      "",
      "- First item",
      "- Second item",
      "",
      "Done.",
    ].join("\n");
    expect(prepareSpeechBlocks(markdown)).toEqual([
      { kind: "heading", text: "What happens next." },
      { kind: "list-item", text: "First item." },
      { kind: "list-item", text: "Second item." },
      { kind: "paragraph", text: "Done." },
    ]);
  });

  it("speaks the word breaks in a snake_case code span", () => {
    expect(prepareSpeechText("Set `speech_dir` first.")).toBe("Set speech dir first.");
  });
});

describe("renderSpeechText", () => {
  const blocks = [
    { kind: "heading", text: "Confirming the model." },
    { kind: "list-item", text: "Comments through コメント are not recorded." },
  ] as const;

  it("adds nothing a plain endpoint would read out loud", () => {
    expect(
      renderSpeechText(blocks, { dialect: "plain", voice: "af_heart", cjkVoice: "jf_alpha" }),
    ).toBe("Confirming the model.\n\nComments through コメント are not recorded.");
  });

  it("pauses after each block and hands CJK runs to the other voice", () => {
    expect(
      renderSpeechText(blocks, { dialect: "kokoro", voice: "af_heart", cjkVoice: "jf_alpha" }),
    ).toBe(
      "Confirming the model. [pause:0.6s]\n\n" +
        "Comments through [voice:jf_alpha]コメント[voice:af_heart] are not recorded.",
    );
  });

  it("leaves CJK to the main voice when no second voice is configured", () => {
    expect(renderSpeechText(blocks, { dialect: "kokoro", voice: "af_heart", cjkVoice: "" })).toBe(
      "Confirming the model. [pause:0.6s]\n\nComments through コメント are not recorded.",
    );
  });

  it("keeps CJK punctuation inside the routed run", () => {
    expect(
      renderSpeechText([{ kind: "paragraph", text: "記録されません。 Done." }], {
        dialect: "kokoro",
        voice: "af_heart",
        cjkVoice: "jf_alpha",
      }),
    ).toBe("[voice:jf_alpha]記録されません。[voice:af_heart] Done.");
  });

  it("gives a list its shorter beat and never trails the last block", () => {
    expect(
      renderSpeechText(
        [
          { kind: "list-item", text: "One." },
          { kind: "paragraph", text: "Two." },
        ],
        { dialect: "kokoro", voice: "af_heart", cjkVoice: "" },
      ),
    ).toBe("One. [pause:0.35s]\n\nTwo.");
  });
});
