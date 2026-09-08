import type { ReadAloudPlayer } from "@t3tools/client-runtime/read-aloud";

function mediaErrorMessage(audio: HTMLAudioElement): string {
  switch (audio.error?.code) {
    case MediaError.MEDIA_ERR_NETWORK:
      return "The audio could not be downloaded.";
    case MediaError.MEDIA_ERR_DECODE:
      return "The audio could not be decoded.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This browser cannot play the audio format.";
    default:
      return "Audio playback failed.";
  }
}

function playErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "The browser blocked audio playback. Click the button again to play.";
  }
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Audio playback failed.";
}

/**
 * Plays read-aloud audio through a single reused `HTMLAudioElement`, which the
 * app's read-aloud controller drives so only one message plays at a time.
 */
export function createReadAloudPlayer(): ReadAloudPlayer {
  let audio: HTMLAudioElement | null = null;
  let detachListeners: (() => void) | null = null;

  const stop = () => {
    detachListeners?.();
    detachListeners = null;
    if (audio === null) return;
    audio.pause();
    // Dropping the attribute (rather than assigning "") avoids a spurious error event.
    audio.removeAttribute("src");
    audio.load();
  };

  return {
    async play(url, callbacks) {
      stop();
      audio ??= new Audio();
      const element = audio;
      element.preload = "auto";
      const onEnded = () => {
        detachListeners?.();
        detachListeners = null;
        callbacks.onEnded();
      };
      const onError = () => {
        detachListeners?.();
        detachListeners = null;
        callbacks.onError(mediaErrorMessage(element));
      };
      element.addEventListener("ended", onEnded);
      element.addEventListener("error", onError);
      detachListeners = () => {
        element.removeEventListener("ended", onEnded);
        element.removeEventListener("error", onError);
      };
      element.src = url;
      try {
        await element.play();
      } catch (error) {
        stop();
        throw new Error(playErrorMessage(error), { cause: error });
      }
    },
    stop,
  };
}
