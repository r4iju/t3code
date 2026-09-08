/**
 * Owns read-aloud playback for one client. There is one controller per app so
 * only one message ever plays at a time; each client supplies the player and
 * the RPC call, and mirrors state into its UI through `onStateChange`.
 *
 * A message arrives as numbered segments. The first plays as soon as it
 * resolves; from then on the controller always has the next segment's request
 * in flight, so the environment synthesizes ahead of playback and the button
 * only shows "loading" again when synthesis cannot keep up.
 */

export type ReadAloudPhase = "idle" | "loading" | "playing" | "error";

export type ReadAloudState = {
  readonly phase: ReadAloudPhase;
  /** Identifies what is loading or playing so buttons can render their own state. */
  readonly targetKey: string | null;
  readonly error: string | null;
};

export const READ_ALOUD_IDLE_STATE: ReadAloudState = {
  phase: "idle",
  targetKey: null,
  error: null,
};

export type ReadAloudRequest = { readonly key: string };

export type ReadAloudAudio = {
  readonly url: string;
  /** Total segments for the request; the same in every segment's result. */
  readonly segmentCount: number;
};

export type ReadAloudPlaybackCallbacks = {
  readonly onEnded: () => void;
  readonly onError: (message: string) => void;
};

export interface ReadAloudPlayer {
  /** Resolves once audio is audibly playing; rejects when it cannot start. Replaces the clip playing now. */
  play(url: string, callbacks: ReadAloudPlaybackCallbacks): Promise<void>;
  /** Fetches ahead so a later `play` of the same URL starts without a gap. A newer call replaces an older one. */
  preload?(url: string): void;
  /** Idempotent. Releases the underlying audio resources, preloaded clips included. */
  stop(): void;
  /** Applies to the clip playing now and to every clip after it. */
  setPlaybackRate(rate: number): void;
}

export type ReadAloudControllerDependencies<Request extends ReadAloudRequest> = {
  readonly player: ReadAloudPlayer;
  readonly resolveAudio: (
    request: Request,
    segment: number,
    signal: AbortSignal,
  ) => Promise<ReadAloudAudio>;
  /** Returns a reason playback cannot start right now (for example: recording), or null. */
  readonly beforeStart?: (request: Request) => string | null;
  readonly onStateChange: (state: ReadAloudState) => void;
};

export function readAloudMessageKey(input: {
  readonly environmentId: string;
  readonly threadId: string;
  readonly messageId: string;
}): string {
  return `${input.environmentId}:${input.threadId}:${input.messageId}`;
}

export const READ_ALOUD_SAMPLE_KEY = "sample";

export function isReadAloudActive(state: ReadAloudState, key: string): boolean {
  return state.targetKey === key && (state.phase === "loading" || state.phase === "playing");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Could not read this message aloud.";
}

export class ReadAloudController<Request extends ReadAloudRequest = ReadAloudRequest> {
  private readonly dependencies: ReadAloudControllerDependencies<Request>;
  private state: ReadAloudState = READ_ALOUD_IDLE_STATE;
  private operation = 0;
  private abortController: AbortController | null = null;

  constructor(dependencies: ReadAloudControllerDependencies<Request>) {
    this.dependencies = dependencies;
  }

  get currentState(): ReadAloudState {
    return this.state;
  }

  /** Stops when the request is already loading or playing, otherwise starts it. */
  toggle(request: Request): void {
    if (isReadAloudActive(this.state, request.key)) {
      this.stop();
      return;
    }
    void this.start(request);
  }

  /** Resolves once the first segment is audibly playing, or the attempt has failed. */
  async start(request: Request): Promise<void> {
    this.cancelCurrent();
    const veto = this.dependencies.beforeStart?.(request) ?? null;
    if (veto !== null) {
      this.setState({ phase: "error", targetKey: request.key, error: veto });
      return;
    }

    const operation = ++this.operation;
    const abortController = new AbortController();
    this.abortController = abortController;
    const key = request.key;
    const current = () => operation === this.operation && !abortController.signal.aborted;
    const resolve = (segment: number) =>
      this.dependencies.resolveAudio(request, segment, abortController.signal);
    this.setState({ phase: "loading", targetKey: key, error: null });

    let first: ReadAloudAudio;
    try {
      first = await resolve(0);
    } catch (error) {
      if (!current()) return;
      this.abortController = null;
      this.setState({ phase: "error", targetKey: key, error: errorMessage(error) });
      return;
    }
    if (!current()) return;

    const { player } = this.dependencies;
    const count = first.segmentCount;
    // Resolved ahead of playback and not yet played, by segment index.
    const ready = new Map<number, string>();
    let playing = 0;
    let waitingFor: number | null = null;
    let resolveFailure: string | null = null;

    const fail = (message: string) => {
      this.abortController = null;
      player.stop();
      this.setState({ phase: "error", targetKey: key, error: message });
    };
    const finish = () => {
      this.abortController = null;
      player.stop();
      this.setState(READ_ALOUD_IDLE_STATE);
    };

    const advance = (index: number) => {
      if (index >= count) {
        finish();
        return;
      }
      const url = ready.get(index);
      if (url !== undefined) {
        ready.delete(index);
        void playSegment(index, url);
        return;
      }
      if (resolveFailure !== null) {
        fail(resolveFailure);
        return;
      }
      waitingFor = index;
      this.setState({ phase: "loading", targetKey: key, error: null });
    };

    const playSegment = async (index: number, url: string): Promise<void> => {
      playing = index;
      const following = ready.get(index + 1);
      if (following !== undefined) player.preload?.(following);
      // Short or cached clips can end before `play` resolves; that outcome wins.
      let settled = false;
      try {
        await player.play(url, {
          onEnded: () => {
            if (!current()) return;
            settled = true;
            advance(index + 1);
          },
          onError: (message) => {
            if (!current()) return;
            settled = true;
            fail(message);
          },
        });
      } catch (error) {
        if (!current()) return;
        fail(errorMessage(error));
        return;
      }
      if (settled || !current()) return;
      this.setState({ phase: "playing", targetKey: key, error: null });
    };

    // One request in flight at all times keeps the environment synthesizing
    // ahead. A failure waits until playback reaches it, so the segments
    // already in hand still play.
    const resolveAhead = async () => {
      for (let index = 1; index < count; index += 1) {
        let audio: ReadAloudAudio;
        try {
          audio = await resolve(index);
        } catch (error) {
          if (!current()) return;
          resolveFailure = errorMessage(error);
          if (waitingFor === index) fail(resolveFailure);
          return;
        }
        if (!current()) return;
        if (waitingFor === index) {
          waitingFor = null;
          void playSegment(index, audio.url);
        } else {
          ready.set(index, audio.url);
          if (index === playing + 1) player.preload?.(audio.url);
        }
      }
    };

    void resolveAhead();
    await playSegment(0, first.url);
  }

  stop(): void {
    this.cancelCurrent();
    if (this.state.phase !== "idle") this.setState(READ_ALOUD_IDLE_STATE);
  }

  /** Stops playback whose target the predicate rejects, for example when leaving a thread. */
  stopUnless(predicate: (targetKey: string) => boolean): void {
    if (this.state.targetKey === null || predicate(this.state.targetKey)) return;
    this.stop();
  }

  /** Clears a shown error without starting anything. */
  dismissError(): void {
    if (this.state.phase === "error") this.setState(READ_ALOUD_IDLE_STATE);
  }

  private cancelCurrent(): void {
    this.operation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.dependencies.player.stop();
  }

  private setState(next: ReadAloudState): void {
    this.state = next;
    this.dependencies.onStateChange(next);
  }
}
