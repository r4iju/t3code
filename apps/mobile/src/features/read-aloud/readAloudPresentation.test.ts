import { describe, expect, it } from "vite-plus/test";
import { READ_ALOUD_IDLE_STATE } from "@t3tools/client-runtime/read-aloud";

import {
  resolveReadAloudButtonPhase,
  resolveReadAloudButtonPresentation,
} from "./readAloudPresentation";

describe("resolveReadAloudButtonPhase", () => {
  it("only the targeted message leaves idle", () => {
    expect(resolveReadAloudButtonPhase(READ_ALOUD_IDLE_STATE, "a")).toBe("idle");
    expect(
      resolveReadAloudButtonPhase({ phase: "loading", targetKey: "a", error: null }, "a"),
    ).toBe("loading");
    expect(
      resolveReadAloudButtonPhase({ phase: "playing", targetKey: "a", error: null }, "a"),
    ).toBe("playing");
    expect(
      resolveReadAloudButtonPhase({ phase: "playing", targetKey: "a", error: null }, "b"),
    ).toBe("idle");
  });

  it("treats an error as idle so the button offers a retry", () => {
    expect(
      resolveReadAloudButtonPhase({ phase: "error", targetKey: "a", error: "boom" }, "a"),
    ).toBe("idle");
  });
});

describe("resolveReadAloudButtonPresentation", () => {
  it("maps each phase to a label, busy flag, and icon", () => {
    expect(resolveReadAloudButtonPresentation("idle")).toEqual({
      accessibilityLabel: "Read aloud",
      busy: false,
      icon: { ios: "speaker.wave.2", android: "volume_up" },
    });
    expect(resolveReadAloudButtonPresentation("loading")).toEqual({
      accessibilityLabel: "Loading audio",
      busy: true,
      icon: null,
    });
    expect(resolveReadAloudButtonPresentation("playing")).toEqual({
      accessibilityLabel: "Stop reading",
      busy: false,
      icon: { ios: "stop.fill", android: "stop" },
    });
  });
});
