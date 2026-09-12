import {
  type EnvironmentConnectionPhase,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";

export type EnvironmentConnectionNoticeAction =
  | { readonly kind: "retry"; readonly label: "Retry now" }
  | { readonly kind: "pairAgain"; readonly label: "Pair again" }
  | null;

export interface EnvironmentConnectionNoticeContent {
  readonly title: string;
  readonly detail: string;
  readonly action: EnvironmentConnectionNoticeAction;
}

function noticeTitle(phase: EnvironmentConnectionPhase, environmentLabel: string): string {
  switch (phase) {
    case "offline":
      return "You are offline";
    case "connecting":
      return `Connecting to ${environmentLabel}...`;
    case "reconnecting":
      return `Reconnecting to ${environmentLabel}...`;
    case "error":
      return `${environmentLabel} is unavailable`;
    case "available":
      return `${environmentLabel} is disconnected`;
    case "connected":
      return "";
  }
}

function noticeDetail(
  phase: EnvironmentConnectionPhase,
  resourceName: string,
  error: string | null,
): string {
  if (error) {
    return `The app will keep retrying automatically. ${error}`;
  }

  switch (phase) {
    case "offline":
      return `Cached data remains available. The ${resourceName} will load when your connection returns.`;
    case "connecting":
    case "reconnecting":
      return `The ${resourceName} will load as soon as the environment is ready.`;
    case "available":
    case "error":
      return `Reconnect the environment to load the ${resourceName}.`;
    case "connected":
      return "";
  }
}

/** Copy and recovery action for a resource screen whose environment is not connected. */
export function environmentConnectionNoticeContent(input: {
  readonly environmentLabel: string;
  readonly resourceName: string;
  readonly connection: EnvironmentConnectionPresentation;
}): EnvironmentConnectionNoticeContent {
  const { connection } = input;
  if (connection.blockedReason === "pairing") {
    return {
      title: `${input.environmentLabel} no longer accepts this device`,
      detail: `Pair again to load the ${input.resourceName}.`,
      action: { kind: "pairAgain", label: "Pair again" },
    };
  }
  return {
    title: noticeTitle(connection.phase, input.environmentLabel),
    detail: noticeDetail(connection.phase, input.resourceName, connection.error),
    action: connection.phase === "offline" ? null : { kind: "retry", label: "Retry now" },
  };
}
