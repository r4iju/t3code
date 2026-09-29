/**
 * Sends one speech request and maps transport, HTTP, and timeout failures onto
 * `SpeechServiceError`, so each provider client only builds its request and
 * reads its own response body.
 */
import { SpeechServiceError } from "@t3tools/contracts";
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
      return yield* new SpeechServiceError({
        reason:
          response.status === 401 || response.status === 403
            ? "unauthorized"
            : response.status === 429
              ? "rate-limited"
              : "unavailable",
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
