/**
 * Sends one speech request and maps transport, HTTP, and timeout failures onto
 * `SpeechServiceError`, so each provider client only builds its request and
 * reads its own response body.
 */
import { SpeechServiceError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { HttpClient, type HttpClientRequest, type HttpClientResponse } from "effect/unstable/http";

export interface SpeechAudioChunk {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

// Local models can take minutes per chunk; a short timeout would only ever
// fail the slow-but-working case.
const REQUEST_TIMEOUT = "3 minutes";
const ERROR_DETAIL_MAX_CHARS = 200;

export const unavailable = (detail: string) =>
  new SpeechServiceError({ reason: "unavailable", detail });

/**
 * The wait a 429 asks for, in milliseconds. `Retry-After` is either seconds or
 * an HTTP date; Gemini sends neither and puts `"retryDelay": "31s"` in the body.
 */
export function retryAfterMs(
  header: string | undefined,
  body: string,
  now: number,
): number | undefined {
  const value = header?.trim() ?? "";
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  if (value.length > 0) {
    const date = Date.parse(value);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1];
  return delay === undefined ? undefined : Number(delay) * 1000;
}

export const sendSpeechRequest = <A, R>(
  request: HttpClientRequest.HttpClientRequest,
  read: (
    response: HttpClientResponse.HttpClientResponse,
  ) => Effect.Effect<A, SpeechServiceError, R>,
): Effect.Effect<A, SpeechServiceError, HttpClient.HttpClient | R> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client
      .execute(request)
      .pipe(
        Effect.mapError(
          (error) => new SpeechServiceError({ reason: "unreachable", detail: error.message }),
        ),
      );
    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      const detail = `${response.status} ${body.slice(0, ERROR_DETAIL_MAX_CHARS)}`.trim();
      if (response.status === 429) {
        const wait = retryAfterMs(
          response.headers["retry-after"],
          body,
          yield* Clock.currentTimeMillis,
        );
        return yield* new SpeechServiceError({
          reason: "rate-limited",
          detail,
          ...(wait === undefined ? {} : { retryAfterMs: wait }),
        });
      }
      return yield* new SpeechServiceError({
        reason: response.status === 401 || response.status === 403 ? "unauthorized" : "unavailable",
        detail,
      });
    }
    return yield* read(response);
  }).pipe(
    Effect.timeoutOrElse({
      duration: REQUEST_TIMEOUT,
      orElse: () =>
        new SpeechServiceError({
          reason: "unreachable",
          detail: `No response within ${REQUEST_TIMEOUT}.`,
        }),
    }),
  );
