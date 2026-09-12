import { describe, expect, it, vi } from "vite-plus/test";

import { connectionFloatingStatus } from "./floating-working-status";

const status = (
  connectionState: Parameters<typeof connectionFloatingStatus>[0]["connectionState"],
  overrides: { connectionError?: string | null; environmentLabel?: string | null } = {},
) =>
  connectionFloatingStatus({
    connectionError: overrides.connectionError ?? null,
    connectionBlockedReason: null,
    connectionState,
    environmentLabel:
      overrides.environmentLabel === undefined ? "Mac mini" : overrides.environmentLabel,
    onReconnect: () => {},
    onPairAgain: () => {},
  });

describe("connectionFloatingStatus", () => {
  it("yields the pill to sync and working state once connected", () => {
    expect(status("connected")).toBeNull();
  });

  it("names the environment it is retrying, and says so only after a failure", () => {
    expect(status("connecting")).toMatchObject({
      tone: "reconnecting",
      label: "Reconnecting to Mac mini...",
    });
    expect(status("reconnecting", { connectionError: "ECONNREFUSED" })).toMatchObject({
      tone: "reconnecting",
      label: "Failed to connect. Retrying Mac mini...",
    });
  });

  it("reports why the environment is unreachable", () => {
    expect(status("offline")).toMatchObject({
      tone: "unavailable",
      label: "You are offline",
    });
    expect(status("available")).toMatchObject({
      tone: "unavailable",
      label: "Mac mini is not connected",
    });
    expect(status("error", { connectionError: "handshake timed out" })).toMatchObject({
      label: "Failed to connect to Mac mini: handshake timed out",
    });
    expect(status("error")).toMatchObject({ label: "Failed to connect to Mac mini" });
  });

  it("falls back to a generic name when the environment has no label", () => {
    expect(status("error", { environmentLabel: null })).toMatchObject({
      label: "Failed to connect to Environment",
    });
  });

  it("carries the reconnect handler so the pill can trigger it", () => {
    const onReconnect = vi.fn();
    const pill = connectionFloatingStatus({
      connectionError: null,
      connectionBlockedReason: null,
      connectionState: "offline",
      environmentLabel: "Mac mini",
      onReconnect,
      onPairAgain: () => {},
    });
    if (pill?.kind !== "connection") throw new Error("expected a connection pill");
    pill.onPress();
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it("offers re-pairing instead of a retry once the environment refuses this device", () => {
    const onReconnect = vi.fn();
    const onPairAgain = vi.fn();
    const pill = connectionFloatingStatus({
      connectionError: "The environment credential is invalid.",
      connectionBlockedReason: "pairing",
      connectionState: "error",
      environmentLabel: "Mac mini",
      onReconnect,
      onPairAgain,
    });
    expect(pill).toMatchObject({
      tone: "unavailable",
      label: "Mac mini no longer accepts this device. Tap to pair again.",
    });
    if (pill?.kind !== "connection") throw new Error("expected a connection pill");
    pill.onPress();
    expect(onPairAgain).toHaveBeenCalledOnce();
    expect(onReconnect).not.toHaveBeenCalled();
  });
});
