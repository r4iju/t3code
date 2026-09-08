import { useAtomValue } from "@effect/atom-react";
import {
  READ_ALOUD_IDLE_STATE,
  ReadAloudController,
  readAloudMessageKey,
  type ReadAloudState,
} from "@t3tools/client-runtime/read-aloud";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { withPreparedConnection } from "@t3tools/client-runtime/state/session";
import {
  createEnvironmentRpcCommand,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type ScopedThreadRef,
  type SpeechSynthesizeInput,
  WS_METHODS,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useSyncExternalStore } from "react";

import { toastManager } from "../components/ui/toast";
import { connectionAtomRuntime } from "../connection/runtime";
import { createReadAloudPlayer } from "../lib/readAloudPlayer";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  findLatestSpeakableAssistantMessage,
  readAloudKeyBelongsToThread,
} from "./readAloud.logic";
import { serverEnvironment } from "./server";
import { environmentSession } from "./session";
import { environmentThreadDetails } from "./threads";

export interface ReadAloudRequest {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly input: SpeechSynthesizeInput;
}

export type ReadAloudPhase = "idle" | "loading" | "playing";

const synthesizeSpeech = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:speech:synthesize",
  tag: WS_METHODS.speechSynthesize,
});

let state: ReadAloudState = READ_ALOUD_IDLE_STATE;
const listeners = new Set<() => void>();

/** The one read-aloud controller for this client; the environment synthesizes, the browser plays. */
const controller = new ReadAloudController<ReadAloudRequest>({
  player: createReadAloudPlayer(),
  resolveAudio: (request, signal) =>
    withPreparedConnection(
      {
        registry: appAtomRegistry,
        atom: environmentSession.preparedConnectionValueAtom(request.environmentId),
        signal,
      },
      async (connection) => {
        const result = await runAtomCommand(
          appAtomRegistry,
          synthesizeSpeech,
          { environmentId: request.environmentId, input: request.input },
          { reportFailure: false },
        );
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        const url = resolveAssetUrl(connection.httpBaseUrl, result.value.relativeUrl);
        if (url === null) throw new Error("The environment returned an invalid audio URL.");
        return { url };
      },
    ),
  onStateChange: (next) => {
    state = next;
    for (const listener of listeners) listener();
    if (next.phase === "error") {
      toastManager.add({
        type: "error",
        title: "Read aloud failed",
        description: next.error ?? "Could not read this message aloud.",
      });
      controller.dismissError();
    }
  },
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readAloudPhaseFor(current: ReadAloudState, key: string): ReadAloudPhase {
  if (current.targetKey !== key) return "idle";
  return current.phase === "loading" || current.phase === "playing" ? current.phase : "idle";
}

export const readAloud = {
  toggle: (request: ReadAloudRequest) => controller.toggle(request),
  stop: () => controller.stop(),
  /** Called when the active thread changes so audio never outlives the view it came from. */
  stopOutsideThread: (threadRef: ScopedThreadRef | null) =>
    controller.stopUnless((key) => readAloudKeyBelongsToThread(key, threadRef)),
  get currentState() {
    return controller.currentState;
  },
};

export function useReadAloudState(): ReadAloudState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => READ_ALOUD_IDLE_STATE,
  );
}

/** Per-key phase, so a message button only re-renders when its own state changes. */
export function useReadAloudPhase(key: string): ReadAloudPhase {
  return useSyncExternalStore(
    subscribe,
    () => readAloudPhaseFor(state, key),
    () => "idle" as const,
  );
}

export function useReadAloudActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.phase === "loading" || state.phase === "playing",
    () => false,
  );
}

export const speechConfiguredAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) => (get(serverEnvironment.settingsValueAtom(environmentId))?.speech ?? null) !== null,
  ).pipe(Atom.withLabel(`web-speech-configured:${environmentId}`)),
);

export function useSpeechConfigured(environmentId: EnvironmentId): boolean {
  return useAtomValue(speechConfiguredAtom(environmentId));
}

function warn(title: string, description: string) {
  toastManager.add({ type: "warning", title, description });
}

/**
 * The `speech.readLatest` command: stops current playback, otherwise reads the
 * latest finished response in the active thread. Reads thread state at call
 * time so callers can keep a stable handler.
 */
export function readLatestAloud(threadRef: ScopedThreadRef | null): void {
  const current = controller.currentState;
  if (current.phase === "loading" || current.phase === "playing") {
    controller.stop();
    return;
  }
  if (threadRef === null) {
    warn("Nothing to read aloud", "Open a thread with a finished response first.");
    return;
  }
  if (!appAtomRegistry.get(speechConfiguredAtom(threadRef.environmentId))) {
    warn("Read aloud is off", "Turn it on under Settings → General → Read aloud.");
    return;
  }
  const thread = appAtomRegistry.get(environmentThreadDetails.detailAtom(threadRef));
  const latest = findLatestSpeakableAssistantMessage(thread?.messages ?? []);
  switch (latest.kind) {
    case "streaming":
      warn("Response still in progress", "Wait for the response to finish before reading it.");
      return;
    case "none":
      warn("Nothing to read aloud", "The latest response has no prose to read.");
      return;
    case "found":
      controller.toggle({
        key: readAloudMessageKey({
          environmentId: threadRef.environmentId,
          threadId: threadRef.threadId,
          messageId: latest.message.id,
        }),
        environmentId: threadRef.environmentId,
        input: { _tag: "message", threadId: threadRef.threadId, messageId: latest.message.id },
      });
      return;
  }
}
