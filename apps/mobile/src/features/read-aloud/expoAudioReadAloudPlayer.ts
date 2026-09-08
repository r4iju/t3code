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
 * "loading" until then. Expo never deactivates the audio session by itself, so
 * `stop` releases it explicitly to hand audio back to other apps.
 */
export function createReadAloudPlayer(): ReadAloudPlayer {
  let active: {
    readonly player: AudioPlayer;
    readonly subscription: { remove(): void };
    readonly rejectPending: ((error: Error) => void) | null;
  } | null = null;
  let generation = 0;
  let playbackRate = 1;

  // Pitch correction keeps the voice natural at faster speeds; "high" selects
  // the spectral algorithm, which is the one suited to speech.
  const applyPlaybackRate = (player: AudioPlayer) => {
    player.shouldCorrectPitch = true;
    player.setPlaybackRate(playbackRate, "high");
  };

  const release = () => {
    const current = active;
    if (current === null) return;
    active = null;
    current.subscription.remove();
    try {
      current.player.pause();
      current.player.remove();
    } catch {
      // Removing an already-released native player throws; nothing to reclaim.
    }
    setIsAudioActiveAsync(false).catch(() => {
      // Deactivation only fails when the session is already inactive.
    });
  };

  const stop = () => {
    generation += 1;
    const pendingReject = active?.rejectPending ?? null;
    release();
    pendingReject?.(new Error("Playback stopped."));
  };

  return {
    async play(url, callbacks) {
      stop();
      const token = generation;
      await configurePlaybackAudio();
      if (token !== generation) throw new Error("Playback stopped.");

      const player = createAudioPlayer({ uri: url });
      applyPlaybackRate(player);
      await new Promise<void>((resolve, reject) => {
        let started = false;
        const subscription = player.addListener("playbackStatusUpdate", (status) => {
          if (status.error !== null && status.error.length > 0) {
            const message = `Audio playback failed: ${status.error}`;
            release();
            if (started) callbacks.onError(message);
            else reject(new Error(message));
            return;
          }
          if (status.didJustFinish) {
            release();
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
    stop,
    setPlaybackRate(rate) {
      playbackRate = rate;
      if (active !== null) applyPlaybackRate(active.player);
    },
  };
}
