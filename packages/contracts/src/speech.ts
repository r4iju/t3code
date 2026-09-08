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
});
export type SpeechSettings = typeof SpeechSettings.Type;

export const SpeechSynthesizeInput = Schema.Union([
  Schema.TaggedStruct("message", {
    threadId: ThreadId,
    messageId: MessageId,
  }),
  /** Speaks the fixed sample sentence with the current configuration. */
  Schema.TaggedStruct("sample", {}),
]);
export type SpeechSynthesizeInput = typeof SpeechSynthesizeInput.Type;

export const SpeechSynthesizeResult = Schema.Struct({
  relativeUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  expiresAt: Schema.Number,
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
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
        return "The speech service returned an audio format that cannot be stitched.";
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
  SpeechServiceError,
  SpeechCacheError,
]);
export type SpeechSynthesizeError = typeof SpeechSynthesizeError.Type;
