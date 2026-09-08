import type { ReadAloudPhase } from "../../state/readAloud";

export const READ_ALOUD_BUTTON_LABELS: Record<ReadAloudPhase, string> = {
  idle: "Read aloud",
  loading: "Loading audio",
  playing: "Stop reading",
};

/**
 * The read-aloud button shadows the copy button (finished, non-streaming
 * responses only) and additionally needs a server thread to synthesize from,
 * an environment with speech configured, and prose worth speaking.
 */
export function resolveReadAloudButtonVisibility(input: {
  readonly showCopyButton: boolean;
  readonly streaming: boolean;
  readonly hasThreadRef: boolean;
  readonly speechConfigured: boolean;
  readonly speakable: boolean;
}): boolean {
  return (
    input.showCopyButton &&
    !input.streaming &&
    input.hasThreadRef &&
    input.speechConfigured &&
    input.speakable
  );
}
