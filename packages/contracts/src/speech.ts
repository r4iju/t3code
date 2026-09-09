import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { MessageId, ThreadId, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

/**
 * Read-aloud synthesis is environment-owned: the environment resolves the
 * message text, talks to the speech service, caches the audio, and hands back a
 * signed asset URL. Clients only choose what to speak and play the result.
 */

export const SPEECH_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const SPEECH_DEFAULT_MODEL = "gpt-4o-mini-tts";
export const SPEECH_DEFAULT_VOICE = "alloy";
export const SPEECH_DEFAULT_MAX_CHARS_PER_REQUEST = 4096;
/** Total prepared characters an environment will synthesize for one message. */
export const SPEECH_MAX_TOTAL_CHARS = 24_000;
/** Spoken by "Test voice" so owners can confirm an endpoint before relying on it. */
export const SPEECH_SAMPLE_TEXT =
  "Read aloud is working. This voice will read finished agent responses to you.";

/** Client-side playback speeds; clients time-stretch the audio so the voice keeps its pitch. */
export const READ_ALOUD_PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;
export const ReadAloudPlaybackRate = Schema.Literals(READ_ALOUD_PLAYBACK_RATES);
export type ReadAloudPlaybackRate = typeof ReadAloudPlaybackRate.Type;
export const DEFAULT_READ_ALOUD_PLAYBACK_RATE: ReadAloudPlaybackRate = 1.5;

export function isReadAloudPlaybackRate(value: unknown): value is ReadAloudPlaybackRate {
  return (READ_ALOUD_PLAYBACK_RATES as ReadonlyArray<unknown>).includes(value);
}

/** The label every client shows for a speed: "1×", "1.5×". */
export function formatReadAloudPlaybackRate(rate: ReadAloudPlaybackRate): string {
  return `${rate}×`;
}

/**
 * What an endpoint understands beyond the OpenAI request shape. Kokoro reads
 * inline `[pause:Ns]` and `[voice:name]` markers, which lets read aloud put a
 * beat between bullets and hand Japanese to a Japanese voice; every other
 * endpoint would speak those markers out loud, so they stay opt-in.
 */
export const SPEECH_DIALECTS = ["plain", "kokoro"] as const;
export const SpeechDialect = Schema.Literals(SPEECH_DIALECTS);
export type SpeechDialect = typeof SpeechDialect.Type;
export const SPEECH_DEFAULT_DIALECT: SpeechDialect = "plain";

/**
 * Han characters carry no script of their own, so a run of them could be either
 * language and a message can hold both. We read all of it as Japanese rather
 * than guess per run: a wrong reading beats spelling every character out, and
 * an owner who wants Chinese names a `z` voice instead.
 */
export const SPEECH_DEFAULT_CJK_VOICE = "jf_alpha";

export const SPEECH_DIALECT_LABELS: Record<SpeechDialect, string> = {
  plain: "Standard",
  kokoro: "Kokoro",
};

export const SpeechSettings = Schema.Struct({
  /** Any endpoint that speaks the OpenAI speech API shape, cloud or local. */
  baseUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
  /** Optional: local servers commonly run without authentication. Redacted for clients. */
  apiKey: TrimmedString.check(Schema.isMaxLength(4096)),
  model: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  voice: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  /** Per-request character ceiling; long messages are chunked below it. */
  maxCharsPerRequest: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(200),
    Schema.isLessThanOrEqualTo(SPEECH_MAX_TOTAL_CHARS),
  ),
  /** Which inline markers this endpoint understands. Defaults keep older settings working. */
  dialect: SpeechDialect.pipe(Schema.withDecodingDefault(Effect.succeed(SPEECH_DEFAULT_DIALECT))),
  /**
   * Voice for Japanese, Chinese and Korean runs. An English voice spells those
   * characters out one by one instead of reading them, so they go to a voice
   * whose own language pipeline can. Empty leaves them to the main voice.
   * Kokoro has no Korean voice, so Hangul lands on this one too.
   */
  cjkVoice: TrimmedString.check(Schema.isMaxLength(200)).pipe(
    Schema.withDecodingDefault(Effect.succeed(SPEECH_DEFAULT_CJK_VOICE)),
  ),
});
export type SpeechSettings = typeof SpeechSettings.Type;

export const SpeechSource = Schema.Union([
  Schema.TaggedStruct("message", {
    threadId: ThreadId,
    messageId: MessageId,
  }),
  /** Speaks the fixed sample sentence with the current configuration. */
  Schema.TaggedStruct("sample", {}),
]);
export type SpeechSource = typeof SpeechSource.Type;

/**
 * One call synthesizes one segment. Segments are sentence-aligned and grow from
 * a few sentences up to `maxCharsPerRequest`, so the first plays within seconds
 * while the client keeps asking for the rest; `segmentCount` in the result says
 * how many there are.
 */
export const SpeechSynthesizeInput = Schema.Struct({
  source: SpeechSource,
  segment: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type SpeechSynthesizeInput = typeof SpeechSynthesizeInput.Type;

export const SpeechSynthesizeResult = Schema.Struct({
  relativeUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  expiresAt: Schema.Number,
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  segmentCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type SpeechSynthesizeResult = typeof SpeechSynthesizeResult.Type;

export class SpeechNotConfiguredError extends Schema.TaggedError<SpeechNotConfiguredError>()(
  "SpeechNotConfiguredError",
  {},
) {
  override get message(): string {
    return "Read aloud is not configured on this environment.";
  }
}

export class SpeechMessageNotFoundError extends Schema.TaggedError<SpeechMessageNotFoundError>()(
  "SpeechMessageNotFoundError",
  { threadId: ThreadId, messageId: MessageId },
) {
  override get message(): string {
    return "The message to read aloud was not found.";
  }
}

export class SpeechMessageStreamingError extends Schema.TaggedError<SpeechMessageStreamingError>()(
  "SpeechMessageStreamingError",
  { threadId: ThreadId, messageId: MessageId },
) {
  override get message(): string {
    return "Wait for the response to finish before reading it aloud.";
  }
}

export class SpeechNothingToReadError extends Schema.TaggedError<SpeechNothingToReadError>()(
  "SpeechNothingToReadError",
  {},
) {
  override get message(): string {
    return "This message has no prose to read aloud.";
  }
}

export class SpeechTooLongError extends Schema.TaggedError<SpeechTooLongError>()(
  "SpeechTooLongError",
  { characters: Schema.Int, limit: Schema.Int },
) {
  override get message(): string {
    return `This message is too long to read aloud (${this.characters} of ${this.limit} characters).`;
  }
}

/** The segmentation changed under a client mid-message, which only a settings edit can cause. */
export class SpeechSegmentNotFoundError extends Schema.TaggedError<SpeechSegmentNotFoundError>()(
  "SpeechSegmentNotFoundError",
  { segment: Schema.Int, segmentCount: Schema.Int },
) {
  override get message(): string {
    return "The rest of this message is no longer available to read aloud. Play it again.";
  }
}

export const SpeechServiceFailureReason = Schema.Literals([
  "unreachable",
  "unauthorized",
  "rate-limited",
  "unsupported-format",
  "unavailable",
]);
export type SpeechServiceFailureReason = typeof SpeechServiceFailureReason.Type;

export class SpeechServiceError extends Schema.TaggedError<SpeechServiceError>()(
  "SpeechServiceError",
  { reason: SpeechServiceFailureReason, detail: TrimmedString },
) {
  override get message(): string {
    switch (this.reason) {
      case "unreachable":
        return "The speech service could not be reached.";
      case "unauthorized":
        return "The speech service rejected the API key.";
      case "rate-limited":
        return "The speech service is rate limiting requests.";
      case "unsupported-format":
        return "The speech service returned an audio format that cannot be played.";
      case "unavailable":
        return "The speech service returned an error.";
    }
  }
}

export class SpeechCacheError extends Schema.TaggedError<SpeechCacheError>()("SpeechCacheError", {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return "Failed to store the synthesized audio.";
  }
}

/** The environment could not read its own settings or projection; not a speech-service fault. */
export class SpeechEnvironmentError extends Schema.TaggedError<SpeechEnvironmentError>()(
  "SpeechEnvironmentError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The environment could not prepare read aloud.";
  }
}

export const SpeechSynthesizeError = Schema.Union([
  SpeechEnvironmentError,
  SpeechNotConfiguredError,
  SpeechMessageNotFoundError,
  SpeechMessageStreamingError,
  SpeechNothingToReadError,
  SpeechTooLongError,
  SpeechSegmentNotFoundError,
  SpeechServiceError,
  SpeechCacheError,
]);
export type SpeechSynthesizeError = typeof SpeechSynthesizeError.Type;
