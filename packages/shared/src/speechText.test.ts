import { describe, expect, it } from "vite-plus/test";

import {
  prepareSpeechText,
  SPEECH_FIRST_SEGMENT_CHARS,
  SPEECH_TABLE_OMITTED_NOTE,
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

  it("replaces a table with the spoken note once", () => {
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
    expect(prepareSpeechText(markdown)).toBe(`Results:\n\n${SPEECH_TABLE_OMITTED_NOTE}\n\nDone.`);
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
