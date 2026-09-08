import { type ReadAloudState } from "@t3tools/client-runtime/read-aloud";

/** What one message's button shows; only the message being loaded or played leaves "idle". */
export type ReadAloudButtonPhase = "idle" | "loading" | "playing";

export function resolveReadAloudButtonPhase(
  state: ReadAloudState,
  key: string,
): ReadAloudButtonPhase {
  if (state.targetKey !== key) return "idle";
  if (state.phase === "loading" || state.phase === "playing") return state.phase;
  return "idle";
}

export type ReadAloudButtonPresentation = {
  readonly accessibilityLabel: string;
  readonly busy: boolean;
  /** `null` while loading: the button shows a spinner instead of a symbol. */
  readonly icon:
    | { readonly ios: "speaker.wave.2"; readonly android: "volume_up" }
    | { readonly ios: "stop.fill"; readonly android: "stop" }
    | null;
};

export function resolveReadAloudButtonPresentation(
  phase: ReadAloudButtonPhase,
): ReadAloudButtonPresentation {
  switch (phase) {
    case "idle":
      return {
        accessibilityLabel: "Read aloud",
        busy: false,
        icon: { ios: "speaker.wave.2", android: "volume_up" },
      };
    case "loading":
      return { accessibilityLabel: "Loading audio", busy: true, icon: null };
    case "playing":
      return {
        accessibilityLabel: "Stop reading",
        busy: false,
        icon: { ios: "stop.fill", android: "stop" },
      };
  }
}
