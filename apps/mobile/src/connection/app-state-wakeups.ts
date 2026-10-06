import type { Wakeups } from "@t3tools/client-runtime/connection";

// Brief trips away should reuse a responsive socket. The foreground probe
// still replaces dead sockets promptly; this bounds how long we try reusing one.
export const MOBILE_BACKGROUND_RECONNECT_AFTER_MS = 3 * 60_000;

export type MobileApplicationActiveWakeup = Extract<
  Wakeups.ConnectionWakeup,
  "application-active-probe" | "application-active-reconnect"
>;

export function mobileApplicationActiveWakeup(
  backgroundedAtMs: number | null,
  activeAtMs: number,
): MobileApplicationActiveWakeup {
  return backgroundedAtMs !== null &&
    activeAtMs - backgroundedAtMs >= MOBILE_BACKGROUND_RECONNECT_AFTER_MS
    ? "application-active-reconnect"
    : "application-active-probe";
}
