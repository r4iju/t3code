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
 * Plays read-aloud audio through `HTMLAudioElement`s that the app's read-aloud
 * controller drives, so only one message plays at a time. One element plays
 * while a second buffers the next segment, and `play` promotes the buffered
 * element when its URL matches so segments follow each other without a gap.
 */
export function createReadAloudPlayer(): ReadAloudPlayer {
  let active: HTMLAudioElement | null = null;
  let detachListeners: (() => void) | null = null;
  let preloaded: { readonly element: HTMLAudioElement; readonly url: string } | null = null;
  let playbackRate = 1;

  // Loading a new source resets playbackRate to defaultPlaybackRate, so set both.
  const applyPlaybackRate = (element: HTMLAudioElement) => {
    element.defaultPlaybackRate = playbackRate;
    element.playbackRate = playbackRate;
  };

  const createElement = (url: string) => {
    const element = new Audio();
    element.preload = "auto";
    // Time-stretch instead of resampling, so faster speeds keep the voice's pitch.
    element.preservesPitch = true;
    element.src = url;
    applyPlaybackRate(element);
    return element;
  };

  const discard = (element: HTMLAudioElement) => {
    element.pause();
    // Dropping the attribute (rather than assigning "") avoids a spurious error event.
    element.removeAttribute("src");
    element.load();
  };

  const release = () => {
    detachListeners?.();
    detachListeners = null;
    if (active === null) return;
    discard(active);
    active = null;
  };

  const stop = () => {
    release();
    if (preloaded === null) return;
    discard(preloaded.element);
    preloaded = null;
  };

  return {
    async play(url, callbacks) {
      release();
      let element: HTMLAudioElement;
      if (preloaded !== null && preloaded.url === url) {
        element = preloaded.element;
        preloaded = null;
      } else {
        element = createElement(url);
      }
      active = element;
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
      try {
        await element.play();
      } catch (error) {
        stop();
        throw new Error(playErrorMessage(error), { cause: error });
      }
    },
    preload(url) {
      if (preloaded?.url === url) return;
      if (preloaded !== null) discard(preloaded.element);
      preloaded = { element: createElement(url), url };
    },
    stop,
    setPlaybackRate(rate) {
      playbackRate = rate;
      if (active !== null) applyPlaybackRate(active);
      if (preloaded !== null) applyPlaybackRate(preloaded.element);
    },
  };
}
