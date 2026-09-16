import type { ReadAloudPlayer } from "@t3tools/client-runtime/read-aloud";
import {
  type AudioPlayer,
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
} from "expo-audio";

async function configurePlaybackAudio(): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: false,
    interruptionMode: "doNotMix",
    playsInSilentMode: true,
    shouldPlayInBackground: false,
  });
  await setIsAudioActiveAsync(true);
}

/**
 * Plays one synthesized clip at a time through expo-audio. `play` resolves once
 * the status stream reports audible playback, so the controller can show
 * "loading" until then. Consecutive segments of one message share the audio
 * session and the next one is created ahead of time, so they follow each other
 * without a gap. Expo never deactivates the session by itself, so `stop`
 * releases it explicitly to hand audio back to other apps.
 */
export function createReadAloudPlayer(): ReadAloudPlayer {
  let active: {
    readonly player: AudioPlayer;
    readonly subscription: { remove(): void };
    readonly rejectPending: ((error: Error) => void) | null;
  } | null = null;
  let preloaded: { readonly player: AudioPlayer; readonly url: string } | null = null;
  let sessionActive = false;
  let generation = 0;
  let playbackRate = 1;

  // Pitch correction keeps the voice natural at faster speeds; "high" selects
  // the spectral algorithm, which is the one suited to speech.
  const applyPlaybackRate = (player: AudioPlayer) => {
    player.shouldCorrectPitch = true;
    player.setPlaybackRate(playbackRate, "high");
  };

  const removePlayer = (player: AudioPlayer) => {
    try {
      player.pause();
      player.remove();
    } catch {
      // Removing an already-released native player throws; nothing to reclaim.
    }
  };

  // Drops the clip but keeps the audio session, so the next segment starts at once.
  const releaseActive = () => {
    const current = active;
    if (current === null) return;
    active = null;
    current.subscription.remove();
    removePlayer(current.player);
  };

  const supersede = () => {
    generation += 1;
    const pendingReject = active?.rejectPending ?? null;
    releaseActive();
    pendingReject?.(new Error("Playback stopped."));
  };

  const stop = () => {
    supersede();
    if (preloaded !== null) {
      removePlayer(preloaded.player);
      preloaded = null;
    }
    if (!sessionActive) return;
    sessionActive = false;
    setIsAudioActiveAsync(false).catch(() => {
      // Deactivation only fails when the session is already inactive.
    });
  };

  return {
    async play(url, callbacks) {
      supersede();
      const token = generation;
      if (!sessionActive) {
        await configurePlaybackAudio();
        if (token !== generation) throw new Error("Playback stopped.");
        sessionActive = true;
      }

      let player: AudioPlayer;
      if (preloaded !== null && preloaded.url === url) {
        player = preloaded.player;
        preloaded = null;
      } else {
        player = createAudioPlayer({ uri: url });
        applyPlaybackRate(player);
      }
      await new Promise<void>((resolve, reject) => {
        let started = false;
        const subscription = player.addListener("playbackStatusUpdate", (status) => {
          if (status.error !== null && status.error.length > 0) {
            const message = `Audio playback failed: ${status.error}`;
            releaseActive();
            if (started) callbacks.onError(message);
            else reject(new Error(message));
            return;
          }
          if (status.didJustFinish) {
            releaseActive();
            if (!started) {
              started = true;
              resolve();
            }
            callbacks.onEnded();
            return;
          }
          if (!started && status.playing) {
            started = true;
            if (active !== null) active = { ...active, rejectPending: null };
            resolve();
          }
        });
        active = { player, subscription, rejectPending: reject };
        player.play();
      });
    },
    preload(url) {
      if (preloaded?.url === url) return;
      if (preloaded !== null) removePlayer(preloaded.player);
      const player = createAudioPlayer({ uri: url });
      applyPlaybackRate(player);
      preloaded = { player, url };
    },
    stop,
    setPlaybackRate(rate) {
      playbackRate = rate;
      if (active !== null) applyPlaybackRate(active.player);
      if (preloaded !== null) applyPlaybackRate(preloaded.player);
    },
  };
}
