/**
 * Owns read-aloud playback for one client. There is one controller per app so
 * only one message ever plays at a time; each client supplies the player and
 * the RPC call, and mirrors state into its UI through `onStateChange`.
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

export type ReadAloudPlaybackCallbacks = {
  readonly onEnded: () => void;
  readonly onError: (message: string) => void;
};

export interface ReadAloudPlayer {
  /** Resolves once audio is audibly playing; rejects when it cannot start. */
  play(url: string, callbacks: ReadAloudPlaybackCallbacks): Promise<void>;
  /** Idempotent. Releases the underlying audio resources. */
  stop(): void;
  /** Applies to the clip playing now and to every clip after it. */
  setPlaybackRate(rate: number): void;
}

export type ReadAloudControllerDependencies<Request extends ReadAloudRequest> = {
  readonly player: ReadAloudPlayer;
  readonly resolveAudio: (
    request: Request,
    signal: AbortSignal,
  ) => Promise<{ readonly url: string }>;
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
    this.setState({ phase: "loading", targetKey: request.key, error: null });

    let url: string;
    try {
      const resolved = await this.dependencies.resolveAudio(request, abortController.signal);
      url = resolved.url;
    } catch (error) {
      if (operation !== this.operation || abortController.signal.aborted) return;
      this.abortController = null;
      this.setState({ phase: "error", targetKey: request.key, error: errorMessage(error) });
      return;
    }
    if (operation !== this.operation || abortController.signal.aborted) return;

    // Short or cached clips can end before `play` resolves; that outcome wins.
    let settled = false;
    try {
      await this.dependencies.player.play(url, {
        onEnded: () => {
          if (operation !== this.operation) return;
          settled = true;
          this.abortController = null;
          this.setState(READ_ALOUD_IDLE_STATE);
        },
        onError: (message) => {
          if (operation !== this.operation) return;
          settled = true;
          this.abortController = null;
          this.dependencies.player.stop();
          this.setState({ phase: "error", targetKey: request.key, error: message });
        },
      });
    } catch (error) {
      if (operation !== this.operation || abortController.signal.aborted) return;
      this.abortController = null;
      this.dependencies.player.stop();
      this.setState({ phase: "error", targetKey: request.key, error: errorMessage(error) });
      return;
    }
    if (settled || operation !== this.operation || abortController.signal.aborted) return;
    this.setState({ phase: "playing", targetKey: request.key, error: null });
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
