import { describe, expect, it } from "vite-plus/test";
import {
  MessageId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type OrchestrationSession,
} from "@t3tools/contracts";

import {
  autoResumeMessageId,
  countTrailingAutoResumes,
  resolveResumeAction,
  shouldAutoScheduleResume,
  withoutFastMode,
} from "./UsageLimitResumePolicy.ts";

const RESETS_AT = "2026-09-24T13:50:00.000Z";

const session = (status: OrchestrationSession["status"]): OrchestrationSession => ({
  threadId: ThreadId.make("thread-1"),
  status,
  providerName: "claudeAgent",
  runtimeMode: "full-access",
  activeTurnId: null,
  lastError: null,
  updatedAt: "2026-09-24T11:00:00.000Z",
});

const scheduled = {
  reachedAt: "2026-09-24T11:00:00.000Z",
  resetsAt: RESETS_AT,
  resumeScheduled: true,
};

describe("resolveResumeAction", () => {
  it("does nothing for threads without a scheduled resume", () => {
    expect(resolveResumeAction({ usageLimit: null, session: null }, RESETS_AT)).toBeNull();
    expect(
      resolveResumeAction(
        { usageLimit: { ...scheduled, resumeScheduled: false }, session: session("error") },
        "2026-09-24T15:00:00.000Z",
      ),
    ).toBeNull();
  });

  it("waits until a grace period after the reset", () => {
    expect(
      resolveResumeAction({ usageLimit: scheduled, session: session("error") }, RESETS_AT),
    ).toBe("wait");
    expect(
      resolveResumeAction(
        { usageLimit: scheduled, session: session("error") },
        "2026-09-24T13:51:00.000Z",
      ),
    ).toBe("send");
  });

  it("stops a turn still parked on the limit before sending", () => {
    expect(
      resolveResumeAction(
        { usageLimit: scheduled, session: session("running") },
        "2026-09-24T14:00:00.000Z",
      ),
    ).toBe("interrupt");
    expect(
      resolveResumeAction(
        { usageLimit: scheduled, session: session("starting") },
        "2026-09-24T14:00:00.000Z",
      ),
    ).toBe("wait");
  });
});

describe("shouldAutoScheduleResume", () => {
  const limit = { ...scheduled, resumeScheduled: false };

  it("schedules a known reset when the setting is on", () => {
    expect(
      shouldAutoScheduleResume({ enabled: true, usageLimit: limit, trailingAutoResumes: 0 }),
    ).toBe(true);
    expect(
      shouldAutoScheduleResume({ enabled: false, usageLimit: limit, trailingAutoResumes: 0 }),
    ).toBe(false);
    expect(
      shouldAutoScheduleResume({
        enabled: true,
        usageLimit: { ...limit, resetsAt: null },
        trailingAutoResumes: 0,
      }),
    ).toBe(false);
  });

  it("retries once, then leaves the thread for the user", () => {
    expect(
      shouldAutoScheduleResume({ enabled: true, usageLimit: limit, trailingAutoResumes: 1 }),
    ).toBe(true);
    expect(
      shouldAutoScheduleResume({ enabled: true, usageLimit: limit, trailingAutoResumes: 2 }),
    ).toBe(false);
  });
});

describe("countTrailingAutoResumes", () => {
  const user = (id: string) => ({ id: MessageId.make(id), role: "user" as const });
  const assistant = (id: string) => ({ id: MessageId.make(id), role: "assistant" as const });

  it("counts only the unbroken run of resume messages at the end", () => {
    expect(
      countTrailingAutoResumes([
        user(autoResumeMessageId("a")),
        user("manual"),
        assistant("reply"),
        user(autoResumeMessageId("b")),
        assistant("reply-2"),
        user(autoResumeMessageId("c")),
      ]),
    ).toBe(2);
    expect(countTrailingAutoResumes([user(autoResumeMessageId("a")), user("manual")])).toBe(0);
  });
});

describe("withoutFastMode", () => {
  const base = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus" };

  it("turns fast mode off and drops a fast service tier", () => {
    const selection: ModelSelection = {
      ...base,
      options: [
        { id: "fastMode", value: true },
        { id: "serviceTier", value: "fast" },
        { id: "effort", value: "high" },
      ],
    };
    expect(withoutFastMode(selection).options).toEqual([
      { id: "fastMode", value: false },
      { id: "effort", value: "high" },
    ]);
  });

  it("returns selections without fast mode unchanged", () => {
    const flex: ModelSelection = { ...base, options: [{ id: "serviceTier", value: "flex" }] };
    expect(withoutFastMode(flex)).toBe(flex);
    expect(withoutFastMode(base)).toBe(base);
  });
});
