import { MessageId, type OrchestrationV2ConversationMessage, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { resolveSpeechMessageText } from "./speechSource.ts";

const ids = { threadId: ThreadId.make("thread-1"), messageId: MessageId.make("message-1") };
const message = (
  overrides: Partial<OrchestrationV2ConversationMessage>,
): OrchestrationV2ConversationMessage => ({
  createdBy: "agent",
  creationSource: "provider",
  id: ids.messageId,
  role: "assistant",
  text: "Done.",
  threadId: ids.threadId,
  runId: null,
  nodeId: null,
  attachments: [],
  streaming: false,
  createdAt: DateTime.makeUnsafe("2026-09-08T00:00:00.000Z"),
  updatedAt: DateTime.makeUnsafe("2026-09-08T00:00:00.000Z"),
  ...overrides,
});

describe("resolveSpeechMessageText", () => {
  it.effect("returns the text of a finished assistant message", () =>
    Effect.gen(function* () {
      expect(yield* resolveSpeechMessageText(Option.some({ message: message({}) }), ids)).toBe(
        "Done.",
      );
    }),
  );

  it.effect("reports missing and user messages as not found", () =>
    Effect.gen(function* () {
      expect((yield* Effect.flip(resolveSpeechMessageText(Option.none(), ids)))._tag).toBe(
        "SpeechMessageNotFoundError",
      );
      const user = yield* Effect.flip(
        resolveSpeechMessageText(Option.some({ message: message({ role: "user" }) }), ids),
      );
      expect(user._tag).toBe("SpeechMessageNotFoundError");
    }),
  );

  it.effect("asks the caller to wait while the message is streaming", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveSpeechMessageText(Option.some({ message: message({ streaming: true }) }), ids),
      );
      expect(error._tag).toBe("SpeechMessageStreamingError");
      expect(error.threadId).toBe(ids.threadId);
    }),
  );
});
