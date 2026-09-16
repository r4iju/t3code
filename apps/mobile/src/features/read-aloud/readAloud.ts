import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { withPreparedConnection } from "@t3tools/client-runtime/state/session";
import {
  type AtomCommandResult,
  createEnvironmentRpcCommand,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  READ_ALOUD_IDLE_STATE,
  ReadAloudController,
  readAloudErrorMessage,
  type ReadAloudState,
} from "@t3tools/client-runtime/read-aloud";
import {
  DEFAULT_READ_ALOUD_PLAYBACK_RATE,
  type EnvironmentId,
  type SpeechSource,
  WS_METHODS,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useSyncExternalStore } from "react";
import { Alert } from "react-native";

import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
import { createReadAloudPlayer } from "./expoAudioReadAloudPlayer";

export type ReadAloudRequest = {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly input: SpeechSource;
};

const speechSynthesize = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "read-aloud:speech-synthesize",
  tag: WS_METHODS.speechSynthesize,
});

/**
 * Turns a failed synthesis command into an error the alert can act on. The raw
 * cause is logged because a squashed cause often carries the only clue (a tag,
 * a parse failure) and the alert has room for one sentence. A client whose code
 * disagrees with the environment — an app build older than the server — arrives
 * here as a cause with nothing to report, so say what fixes it.
 */
type SpeechCommandFailure = Extract<
  AtomCommandResult<unknown, unknown>,
  { readonly _tag: "Failure" }
>;

function speechRequestError(result: SpeechCommandFailure): Error {
  console.error("Read aloud: speech.synthesize failed", result.cause);
  if (isAtomCommandInterrupted(result)) {
    return new Error("Read aloud stopped before the audio was ready. Try again.");
  }
  const squashed = squashAtomCommandFailure(result);
  if (squashed === undefined || squashed === null) {
    return new Error("Read aloud failed. Update the app if the environment was upgraded.");
  }
  return new Error(readAloudErrorMessage(squashed));
}

// The RPC runs to completion even after the controller aborts; it only ignores
// the result, and a finished synthesis stays cached on the environment.
function resolveAudio(
  request: ReadAloudRequest,
  segment: number,
  signal: AbortSignal,
): Promise<{ readonly url: string; readonly segmentCount: number }> {
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
        { environmentId: request.environmentId, input: { source: request.input, segment } },
        { reportFailure: false },
      );
      if (result._tag === "Failure") throw speechRequestError(result);
      const url = resolveAssetUrl(connection.httpBaseUrl, result.value.relativeUrl);
      if (url === null) throw new Error("Could not resolve the audio URL.");
      return { url, segmentCount: result.value.segmentCount };
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

const player = createReadAloudPlayer();

// Deferred to first use so importing this module never forces the preferences
// store to load before the app is ready for it.
let playbackRateSynced = false;
function ensurePlaybackRateSynced(): void {
  if (playbackRateSynced) return;
  playbackRateSynced = true;
  const apply = () => {
    const preferences = appAtomRegistry.get(mobilePreferencesAtom);
    if (!AsyncResult.isSuccess(preferences)) return;
    player.setPlaybackRate(
      preferences.value.readAloudPlaybackRate ?? DEFAULT_READ_ALOUD_PLAYBACK_RATE,
    );
  };
  appAtomRegistry.subscribe(mobilePreferencesAtom, apply);
  apply();
}

const controller = new ReadAloudController<ReadAloudRequest>({
  player,
  resolveAudio: (request, segment, signal) => {
    ensurePlaybackRateSynced();
    return resolveAudio(request, segment, signal);
  },
  beforeStart: () => (voiceInputActive ? "Stop recording before reading aloud." : null),
  onStateChange: (next) => {
    state = next;
    for (const listener of listeners) listener();
    if (next.phase === "error") {
      Alert.alert("Read aloud failed", next.error ?? "Read aloud failed for an unknown reason.");
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
