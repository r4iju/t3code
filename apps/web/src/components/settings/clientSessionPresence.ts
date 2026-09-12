import { formatElapsedDurationLabel } from "../../timestampFormat";

/** Inline presence for a paired client: live, or when its last authenticated traffic was. */
export function clientSessionPresenceLabel(
  session: {
    readonly connected: boolean;
    readonly current: boolean;
    readonly lastSeenAt: string | null;
  },
  nowMs: number,
): string {
  if (session.connected || session.current) {
    return "Connected";
  }
  if (session.lastSeenAt === null) {
    return "Not seen yet";
  }
  const elapsed = formatElapsedDurationLabel(session.lastSeenAt, nowMs);
  return elapsed === "just now" ? "Last seen just now" : `Last seen ${elapsed} ago`;
}
