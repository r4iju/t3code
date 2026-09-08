import { describe, expect, it } from "vite-plus/test";

import {
  isReadAloudActive,
  ReadAloudController,
  type ReadAloudPlaybackCallbacks,
  type ReadAloudPlayer,
  type ReadAloudState,
} from "./controller.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

class TestPlayer implements ReadAloudPlayer {
  readonly played: string[] = [];
  stops = 0;
  callbacks: ReadAloudPlaybackCallbacks | null = null;
  private pending = deferred<void>();

  play(url: string, callbacks: ReadAloudPlaybackCallbacks): Promise<void> {
    this.played.push(url);
    this.callbacks = callbacks;
    this.pending = deferred<void>();
    return this.pending.promise;
  }

  stop(): void {
    this.stops += 1;
  }

  started(): void {
    this.pending.resolve();
  }

  failed(error: Error): void {
    this.pending.reject(error);
  }
}

type Request = { readonly key: string };

function createHarness(options?: {
  readonly resolveAudio?: (request: Request, signal: AbortSignal) => Promise<{ url: string }>;
  readonly beforeStart?: (request: Request) => string | null;
}) {
  const player = new TestPlayer();
  const states: ReadAloudState[] = [];
  const resolved: { request: Request; signal: AbortSignal }[] = [];
  const controller = new ReadAloudController<Request>({
    player,
    resolveAudio:
      options?.resolveAudio ??
      (async (request, signal) => {
        resolved.push({ request, signal });
        return { url: `https://env/audio/${request.key}.mp3` };
      }),
    ...(options?.beforeStart ? { beforeStart: options.beforeStart } : {}),
    onStateChange: (state) => states.push(state),
  });
  return { controller, player, states, resolved };
}

// Drains the microtask chain the controller awaits through, without timers.
const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

describe("ReadAloudController", () => {
  it("moves idle → loading → playing and back to idle when playback ends", async () => {
    const { controller, player, states } = createHarness();

    const start = controller.start({ key: "m1" });
    expect(controller.currentState).toEqual({ phase: "loading", targetKey: "m1", error: null });
    await flush();
    expect(player.played).toEqual(["https://env/audio/m1.mp3"]);
    player.started();
    await start;
    expect(controller.currentState).toEqual({ phase: "playing", targetKey: "m1", error: null });
    expect(isReadAloudActive(controller.currentState, "m1")).toBe(true);

    player.callbacks?.onEnded();
    expect(controller.currentState.phase).toBe("idle");
    expect(states.map((state) => state.phase)).toEqual(["loading", "playing", "idle"]);
  });

  it("stop returns to idle and releases the player", async () => {
    const { controller, player } = createHarness();
    const start = controller.start({ key: "m1" });
    await flush();
    player.started();
    await start;

    controller.stop();
    expect(controller.currentState.phase).toBe("idle");
    expect(player.stops).toBeGreaterThanOrEqual(1);
  });

  it("toggle stops the active request and starts a different one", async () => {
    const { controller, player, resolved } = createHarness();
    controller.toggle({ key: "m1" });
    await flush();
    player.started();
    await flush();
    expect(controller.currentState).toMatchObject({ phase: "playing", targetKey: "m1" });

    controller.toggle({ key: "m2" });
    expect(controller.currentState).toMatchObject({ phase: "loading", targetKey: "m2" });
    expect(resolved[0]?.signal.aborted).toBe(true);
    await flush();
    player.started();
    await flush();
    expect(player.played).toEqual(["https://env/audio/m1.mp3", "https://env/audio/m2.mp3"]);
    expect(controller.currentState).toMatchObject({ phase: "playing", targetKey: "m2" });

    controller.toggle({ key: "m2" });
    expect(controller.currentState.phase).toBe("idle");
  });

  it("ignores a resolution that finishes after stop", async () => {
    const pending = deferred<{ url: string }>();
    const { controller, player } = createHarness({ resolveAudio: () => pending.promise });
    void controller.start({ key: "m1" });
    controller.stop();
    pending.resolve({ url: "late" });
    await flush();
    expect(player.played).toEqual([]);
    expect(controller.currentState.phase).toBe("idle");
  });

  it("reports a resolution failure as an error for that target", async () => {
    const { controller } = createHarness({
      resolveAudio: () => Promise.reject(new Error("Read aloud is not configured.")),
    });
    await controller.start({ key: "m1" });
    expect(controller.currentState).toEqual({
      phase: "error",
      targetKey: "m1",
      error: "Read aloud is not configured.",
    });
    expect(isReadAloudActive(controller.currentState, "m1")).toBe(false);
  });

  it("reports a player failure and stops the player", async () => {
    const { controller, player } = createHarness();
    const start = controller.start({ key: "m1" });
    await flush();
    player.failed(new Error("autoplay blocked"));
    await start;
    expect(controller.currentState).toMatchObject({ phase: "error", error: "autoplay blocked" });

    controller.dismissError();
    expect(controller.currentState.phase).toBe("idle");
  });

  it("stays idle when the clip ends before play resolves", async () => {
    const { controller, player } = createHarness();
    const start = controller.start({ key: "m1" });
    await flush();
    player.callbacks?.onEnded();
    player.started();
    await start;
    expect(controller.currentState.phase).toBe("idle");
  });

  it("surfaces a mid-playback player error", async () => {
    const { controller, player } = createHarness();
    const start = controller.start({ key: "m1" });
    await flush();
    player.started();
    await start;
    player.callbacks?.onError("decode failed");
    expect(controller.currentState).toMatchObject({ phase: "error", error: "decode failed" });
  });

  it("refuses to start when beforeStart vetoes", async () => {
    const { controller, player } = createHarness({ beforeStart: () => "Stop recording first." });
    await controller.start({ key: "m1" });
    expect(controller.currentState).toMatchObject({
      phase: "error",
      error: "Stop recording first.",
    });
    expect(player.played).toEqual([]);
  });

  it("stopUnless stops playback for targets outside the predicate", async () => {
    const { controller, player } = createHarness();
    const start = controller.start({ key: "env:t1:m1" });
    await flush();
    player.started();
    await start;

    controller.stopUnless((key) => key.startsWith("env:t1:"));
    expect(controller.currentState.phase).toBe("playing");
    controller.stopUnless((key) => key.startsWith("env:t2:"));
    expect(controller.currentState.phase).toBe("idle");
  });
});
