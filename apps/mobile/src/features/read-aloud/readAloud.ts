import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { withPreparedConnection } from "@t3tools/client-runtime/state/session";
import {
  createEnvironmentRpcCommand,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  READ_ALOUD_IDLE_STATE,
  ReadAloudController,
  type ReadAloudState,
} from "@t3tools/client-runtime/read-aloud";
import { type EnvironmentId, type SpeechSynthesizeInput, WS_METHODS } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { useSyncExternalStore } from "react";
import { Alert } from "react-native";

import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
import { createReadAloudPlayer } from "./expoAudioReadAloudPlayer";

export type ReadAloudRequest = {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly input: SpeechSynthesizeInput;
};

const speechSynthesize = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "read-aloud:speech-synthesize",
  tag: WS_METHODS.speechSynthesize,
});

// The RPC runs to completion even after the controller aborts; it only ignores
// the result, and a finished synthesis stays cached on the environment.
function resolveAudio(
  request: ReadAloudRequest,
  signal: AbortSignal,
): Promise<{ readonly url: string }> {
  return withPreparedConnection(
    {
      registry: appAtomRegistry,
      atom: environmentSession.preparedConnectionValueAtom(request.environmentId),
      signal,
    },
    async (connection) => {
      const result = await runAtomCommand(
        appAtomRegistry,
        speechSynthesize,
        { environmentId: request.environmentId, input: request.input },
        { reportFailure: false },
      );
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const url = resolveAssetUrl(connection.httpBaseUrl, result.value.relativeUrl);
      if (url === null) throw new Error("Could not resolve the audio URL.");
      return { url };
    },
  );
}

let voiceInputActive = false;

/** The composer reports dictation so read aloud never fights it for the audio session. */
export function setVoiceInputActive(active: boolean): void {
  voiceInputActive = active;
}

let state: ReadAloudState = READ_ALOUD_IDLE_STATE;
const listeners = new Set<() => void>();

const controller = new ReadAloudController<ReadAloudRequest>({
  player: createReadAloudPlayer(),
  resolveAudio,
  beforeStart: () => (voiceInputActive ? "Stop recording before reading aloud." : null),
  onStateChange: (next) => {
    state = next;
    for (const listener of listeners) listener();
    if (next.phase === "error") {
      Alert.alert("Read aloud failed", next.error ?? "Could not read this message aloud.");
      controller.dismissError();
    }
  },
});

export const readAloud = {
  toggle: (request: ReadAloudRequest) => controller.toggle(request),
  stop: () => controller.stop(),
  stopUnless: (predicate: (targetKey: string) => boolean) => controller.stopUnless(predicate),
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReadAloudState(): ReadAloudState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Subscribes to a derived value so unrelated messages skip the render. */
export function useReadAloudSelector<T>(select: (state: ReadAloudState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

/** Derived per environment so a settings push only re-renders buttons when the flag flips. */
const speechConfiguredAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) => (get(serverEnvironment.settingsValueAtom(environmentId))?.speech ?? null) !== null,
  ).pipe(Atom.withLabel(`mobile-speech-configured:${environmentId}`)),
);

export function useSpeechConfigured(environmentId: EnvironmentId): boolean {
  return useAtomValue(speechConfiguredAtom(environmentId));
}
