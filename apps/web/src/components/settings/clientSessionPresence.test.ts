import { describe, expect, it } from "vite-plus/test";

import { clientSessionPresenceLabel } from "./clientSessionPresence";

const nowMs = Date.parse("2026-04-08T12:00:00.000Z");

describe("clientSessionPresenceLabel", () => {
  it("reports a live client as connected regardless of last seen", () => {
    expect(
      clientSessionPresenceLabel(
        { connected: true, current: false, lastSeenAt: "2026-04-01T12:00:00.000Z" },
        nowMs,
      ),
    ).toBe("Connected");
    expect(
      clientSessionPresenceLabel({ connected: false, current: true, lastSeenAt: null }, nowMs),
    ).toBe("Connected");
  });

  it("reports when a disconnected client was last seen", () => {
    expect(
      clientSessionPresenceLabel(
        { connected: false, current: false, lastSeenAt: "2026-04-08T09:30:00.000Z" },
        nowMs,
      ),
    ).toBe("Last seen 2h ago");
    expect(
      clientSessionPresenceLabel(
        { connected: false, current: false, lastSeenAt: "2026-04-08T11:59:58.000Z" },
        nowMs,
      ),
    ).toBe("Last seen just now");
  });

  it("says so when a client has never been seen", () => {
    expect(
      clientSessionPresenceLabel({ connected: false, current: false, lastSeenAt: null }, nowMs),
    ).toBe("Not seen yet");
  });
});
