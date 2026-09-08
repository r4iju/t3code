import { describe, expect, it } from "vite-plus/test";

import { prepareSpeechText, SPEECH_TABLE_OMITTED_NOTE, splitSpeechText } from "./speechText.ts";

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

describe("splitSpeechText", () => {
  it("keeps short text as a single chunk", () => {
    expect(splitSpeechText("Hello there.\n\nSecond paragraph.", 100)).toEqual([
      "Hello there.\n\nSecond paragraph.",
    ]);
  });

  it("splits on paragraph boundaries first", () => {
    const text = "Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.";
    expect(splitSpeechText(text, 36)).toEqual([
      "Alpha paragraph.\n\nBeta paragraph.",
      "Gamma paragraph.",
    ]);
  });

  it("splits a long paragraph on sentence boundaries", () => {
    const text = "First sentence here. Second sentence here! Third one?";
    expect(splitSpeechText(text, 45)).toEqual([
      "First sentence here. Second sentence here!",
      "Third one?",
    ]);
  });

  it("never splits a word when a sentence exceeds the limit", () => {
    const text = "alpha beta gamma delta epsilon";
    const chunks = splitSpeechText(text, 12);
    expect(chunks).toEqual(["alpha beta", "gamma delta", "epsilon"]);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(12);
  });

  it("drops empty paragraphs", () => {
    expect(splitSpeechText("\n\n  \n\nonly", 10)).toEqual(["only"]);
  });
});
