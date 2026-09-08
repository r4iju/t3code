import { READ_ALOUD_SAMPLE_KEY, readAloudMessageKey } from "@t3tools/client-runtime/read-aloud";
import { EnvironmentId, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  findLatestSpeakableAssistantMessage,
  readAloudKeyBelongsToThread,
} from "./readAloud.logic";

const environmentId = EnvironmentId.make("env-1");
const threadId = ThreadId.make("thread-1");
const threadRef = { environmentId, threadId };

function message(input: {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  turnId?: string | null;
  streaming?: boolean;
}) {
  return {
    id: MessageId.make(input.id),
    role: input.role,
    text: input.text,
    turnId: input.turnId ? TurnId.make(input.turnId) : null,
    streaming: input.streaming ?? false,
  };
}

describe("readAloudKeyBelongsToThread", () => {
  it("keeps the sample and the active thread's messages, stops everything else", () => {
    const key = readAloudMessageKey({ environmentId, threadId, messageId: "m1" });
    expect(readAloudKeyBelongsToThread(key, threadRef)).toBe(true);
    expect(readAloudKeyBelongsToThread(READ_ALOUD_SAMPLE_KEY, threadRef)).toBe(true);
    expect(readAloudKeyBelongsToThread(READ_ALOUD_SAMPLE_KEY, null)).toBe(true);
    expect(readAloudKeyBelongsToThread(key, null)).toBe(false);
    expect(
      readAloudKeyBelongsToThread(key, {
        environmentId,
        threadId: ThreadId.make("thread-2"),
      }),
    ).toBe(false);
  });

  it("does not match a thread id that is only a prefix", () => {
    const key = readAloudMessageKey({
      environmentId,
      threadId: ThreadId.make("thread-10"),
      messageId: "m1",
    });
    expect(readAloudKeyBelongsToThread(key, threadRef)).toBe(false);
  });
});

describe("findLatestSpeakableAssistantMessage", () => {
  it("returns the final assistant message of the latest turn", () => {
    const result = findLatestSpeakableAssistantMessage([
      message({ id: "u1", role: "user", text: "hi" }),
      message({ id: "a1", role: "assistant", text: "First thought.", turnId: "t1" }),
      message({ id: "a2", role: "assistant", text: "Final answer.", turnId: "t1" }),
    ]);
    expect(result).toEqual({ kind: "found", message: expect.objectContaining({ id: "a2" }) });
  });

  it("reports a streaming latest response instead of reading an older one", () => {
    const result = findLatestSpeakableAssistantMessage([
      message({ id: "a1", role: "assistant", text: "Done earlier.", turnId: "t1" }),
      message({ id: "u2", role: "user", text: "more" }),
      message({ id: "a2", role: "assistant", text: "Working", turnId: "t2", streaming: true }),
    ]);
    expect(result).toEqual({ kind: "streaming" });
  });

  it("skips responses with nothing to speak and falls back to the previous one", () => {
    const result = findLatestSpeakableAssistantMessage([
      message({ id: "a1", role: "assistant", text: "Here is prose.", turnId: "t1" }),
      message({ id: "u2", role: "user", text: "code please" }),
      message({ id: "a2", role: "assistant", text: "```ts\nconst x = 1;\n```", turnId: "t2" }),
    ]);
    expect(result).toEqual({ kind: "found", message: expect.objectContaining({ id: "a1" }) });
  });

  it("groups assistant messages without turn ids by the preceding user message", () => {
    const result = findLatestSpeakableAssistantMessage([
      message({ id: "u1", role: "user", text: "one" }),
      message({ id: "a1", role: "assistant", text: "Part one." }),
      message({ id: "a2", role: "assistant", text: "Part two." }),
      message({ id: "u2", role: "user", text: "two" }),
      message({ id: "a3", role: "assistant", text: "" }),
    ]);
    expect(result).toEqual({ kind: "found", message: expect.objectContaining({ id: "a2" }) });
  });

  it("returns none when no assistant message has prose", () => {
    expect(findLatestSpeakableAssistantMessage([])).toEqual({ kind: "none" });
    expect(
      findLatestSpeakableAssistantMessage([
        message({ id: "u1", role: "user", text: "hi" }),
        message({ id: "s1", role: "system", text: "System note." }),
      ]),
    ).toEqual({ kind: "none" });
  });
});
