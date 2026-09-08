import { expect, it } from "vite-plus/test";

import {
  READ_ALOUD_BUTTON_LABELS,
  resolveReadAloudButtonVisibility,
} from "./ReadAloudButton.logic";

const visibleInput = {
  showCopyButton: true,
  streaming: false,
  hasThreadRef: true,
  speechConfigured: true,
  speakable: true,
};

it("shows the button only for a finished, speakable response in a configured server thread", () => {
  expect(resolveReadAloudButtonVisibility(visibleInput)).toBe(true);
});

it.each([
  ["copy button hidden", { showCopyButton: false }],
  ["still streaming", { streaming: true }],
  ["local draft thread", { hasThreadRef: false }],
  ["speech not configured", { speechConfigured: false }],
  ["nothing to speak", { speakable: false }],
] as const)("hides the button when %s", (_label, override) => {
  expect(resolveReadAloudButtonVisibility({ ...visibleInput, ...override })).toBe(false);
});

it("labels every phase for the accessible name and tooltip", () => {
  expect(READ_ALOUD_BUTTON_LABELS).toEqual({
    idle: "Read aloud",
    loading: "Loading audio",
    playing: "Stop reading",
  });
});
