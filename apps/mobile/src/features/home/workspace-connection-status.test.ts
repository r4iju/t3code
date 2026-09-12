import { describe, expect, it } from "vite-plus/test";

import type { WorkspaceState } from "../../state/workspaceModel";
import { workspaceConnectionStatusPresentation } from "./workspace-connection-status";

function workspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    isLoadingConnections: false,
    hasConnections: true,
    hasLoadedShellSnapshot: true,
    hasPendingShellSnapshot: false,
    hasReadyEnvironment: true,
    hasConnectingEnvironment: false,
    connectingEnvironments: [],
    refusedEnvironments: [],
    connectionState: "connected",
    connectionError: null,
    shellSnapshotError: null,
    latestCachedSnapshotReceivedAt: null,
    networkStatus: "online",
    ...overrides,
  };
}

describe("workspace connection status", () => {
  it("stays hidden while a ready environment is connected", () => {
    expect(workspaceConnectionStatusPresentation(workspaceState())).toBeNull();
  });

  it("surfaces offline snapshots", () => {
    const state = workspaceState({ networkStatus: "offline", hasReadyEnvironment: false });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "You are offline",
      showsProgress: false,
    });
  });

  it("names the environment while reconnecting", () => {
    const state = workspaceState({
      hasConnectingEnvironment: true,
      hasReadyEnvironment: false,
      connectingEnvironments: [
        {
          environmentId: "environment-1" as never,
          environmentLabel: "Julius’s Mac mini",
          displayUrl: "",
          isRelayManaged: false,
          connectionState: "reconnecting",
          connectionError: null,
          connectionErrorTraceId: null,
          connectionBlockedReason: null,
        },
      ],
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Reconnecting to Julius’s Mac mini",
      showsProgress: true,
    });
  });

  it("names the environment that refused this device", () => {
    const state = workspaceState({
      connectionError: "The environment credential is invalid.",
      hasReadyEnvironment: false,
      refusedEnvironments: [
        {
          environmentId: "environment-1" as never,
          environmentLabel: "Julius’s Mac mini",
          displayUrl: "",
          isRelayManaged: false,
          connectionState: "error",
          connectionError: "The environment credential is invalid.",
          connectionErrorTraceId: null,
          connectionBlockedReason: "authentication",
        },
      ],
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Julius’s Mac mini no longer accepts this device",
      showsProgress: false,
    });
  });

  it("surfaces connection errors before the generic disconnected fallback", () => {
    const state = workspaceState({
      connectionError: "Could not reach Julius’s Mac mini",
      hasLoadedShellSnapshot: false,
      hasReadyEnvironment: false,
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Could not reach Julius’s Mac mini",
      showsProgress: false,
    });
  });

  it("shows shell catch-up while cached threads remain visible", () => {
    const state = workspaceState({ hasPendingShellSnapshot: true });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Syncing threads...",
      showsProgress: true,
    });
  });

  it("distinguishes initial shell loading from cached catch-up", () => {
    const state = workspaceState({
      hasLoadedShellSnapshot: false,
      hasPendingShellSnapshot: true,
    });

    expect(workspaceConnectionStatusPresentation(state)).toEqual({
      label: "Loading threads...",
      showsProgress: true,
    });
  });
});
