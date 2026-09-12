import { describe, expect, it } from "vite-plus/test";

import { environmentConnectionNoticeContent } from "./environmentConnectionNoticeContent";

describe("environmentConnectionNoticeContent", () => {
  it("offers re-pairing when the environment refused this device", () => {
    expect(
      environmentConnectionNoticeContent({
        environmentLabel: "Studio Mac",
        resourceName: "terminal",
        connection: {
          phase: "error",
          error: "The environment credential is invalid.",
          traceId: null,
          blockedReason: "authentication",
        },
      }),
    ).toEqual({
      title: "Studio Mac no longer accepts this device",
      detail: "Pair again to load the terminal.",
      action: { kind: "pairAgain", label: "Pair again" },
    });
  });

  it("keeps retrying for an ordinary failure", () => {
    expect(
      environmentConnectionNoticeContent({
        environmentLabel: "Studio Mac",
        resourceName: "terminal",
        connection: {
          phase: "error",
          error: "Relay request timed out.",
          traceId: null,
          blockedReason: null,
        },
      }),
    ).toEqual({
      title: "Studio Mac is unavailable",
      detail: "The app will keep retrying automatically. Relay request timed out.",
      action: { kind: "retry", label: "Retry now" },
    });
  });

  it("has nothing to retry while offline", () => {
    expect(
      environmentConnectionNoticeContent({
        environmentLabel: "Studio Mac",
        resourceName: "review",
        connection: { phase: "offline", error: null, traceId: null, blockedReason: null },
      }),
    ).toEqual({
      title: "You are offline",
      detail: "Cached data remains available. The review will load when your connection returns.",
      action: null,
    });
  });
});
