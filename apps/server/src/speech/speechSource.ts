import {
  type MessageId,
  type OrchestrationMessage,
  SpeechMessageNotFoundError,
  SpeechMessageStreamingError,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Only finished assistant messages are spoken. A user message or a message
 * still streaming is reported as not found or not ready, respectively.
 */
export const resolveSpeechMessageText = (
  message: Option.Option<{ readonly message: OrchestrationMessage }>,
  ids: { readonly threadId: ThreadId; readonly messageId: MessageId },
): Effect.Effect<string, SpeechMessageNotFoundError | SpeechMessageStreamingError> => {
  if (Option.isNone(message) || message.value.message.role !== "assistant") {
    return new SpeechMessageNotFoundError(ids);
  }
  if (message.value.message.streaming) {
    return new SpeechMessageStreamingError(ids);
  }
  return Effect.succeed(message.value.message.text);
};
