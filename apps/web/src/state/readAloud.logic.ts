import { READ_ALOUD_SAMPLE_KEY } from "@t3tools/client-runtime/read-aloud";
import type { OrchestrationMessage, ScopedThreadRef } from "@t3tools/contracts";
import { prepareSpeechText } from "@t3tools/shared/speechText";

/** Whether playback keyed by `key` may continue while `threadRef` is the active thread. */
export function readAloudKeyBelongsToThread(key: string, threadRef: ScopedThreadRef | null) {
  if (key === READ_ALOUD_SAMPLE_KEY) return true;
  return threadRef !== null && key.startsWith(`${threadRef.environmentId}:${threadRef.threadId}:`);
}

type SpeakableMessageCandidate = Pick<
  OrchestrationMessage,
  "id" | "role" | "text" | "streaming" | "turnId"
>;

export type LatestSpeakableAssistantMessage<Message extends SpeakableMessageCandidate> =
  | { readonly kind: "found"; readonly message: Message }
  | { readonly kind: "streaming" }
  | { readonly kind: "none" };

/**
 * Picks the message "read latest response" should speak: the final assistant
 * message of the most recent response that has prose to read. A response is
 * one turn, or one run of assistant messages after a user message when no turn
 * id is known. A still-streaming latest response wins over older ones so the
 * shortcut never reads a stale answer while a new one is arriving.
 */
export function findLatestSpeakableAssistantMessage<Message extends SpeakableMessageCandidate>(
  messages: ReadonlyArray<Message>,
): LatestSpeakableAssistantMessage<Message> {
  const terminalByResponse = new Map<string, Message>();
  let responseIndex = 0;
  for (const message of messages) {
    if (message.role === "user") {
      responseIndex += 1;
      continue;
    }
    if (message.role !== "assistant") continue;
    const responseKey = message.turnId ? `turn:${message.turnId}` : `unkeyed:${responseIndex}`;
    terminalByResponse.set(responseKey, message);
  }

  const terminals = [...terminalByResponse.values()];
  for (let index = terminals.length - 1; index >= 0; index -= 1) {
    const message = terminals[index]!;
    if (message.streaming) return { kind: "streaming" };
    if (prepareSpeechText(message.text).length > 0) return { kind: "found", message };
  }
  return { kind: "none" };
}
