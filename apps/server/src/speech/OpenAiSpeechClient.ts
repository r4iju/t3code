/**
 * One request against an OpenAI-shaped `/audio/speech` endpoint. Any server
 * that speaks that shape works, cloud or local, which is why the base URL and
 * an optional key are all the configuration there is.
 */
import { SpeechServiceError, type SpeechSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

export interface SpeechAudioChunk {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

// Local models can take minutes per chunk; a short timeout would only ever
// fail the slow-but-working case.
const REQUEST_TIMEOUT = "3 minutes";
const DEFAULT_MIME_TYPE = "audio/mpeg";
const ERROR_DETAIL_MAX_CHARS = 200;

function responseMimeType(contentType: string | undefined): string {
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  // We asked for mp3; a server that does not label its bytes is sending that.
  return mimeType.length === 0 || mimeType === "application/octet-stream"
    ? DEFAULT_MIME_TYPE
    : mimeType;
}

export const synthesizeSpeechChunk = Effect.fn("OpenAiSpeechClient.synthesizeSpeechChunk")(
  function* (
    settings: SpeechSettings,
    input: string,
  ): Effect.fn.Return<SpeechAudioChunk, SpeechServiceError, HttpClient.HttpClient> {
    const client = yield* HttpClient.HttpClient;
    const url = `${settings.baseUrl.replace(/\/+$/, "")}/audio/speech`;
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        model: settings.model,
        input,
        voice: settings.voice,
        response_format: "mp3",
        // Kokoro speaks a `[voice:…]` marker out loud unless the request opts
        // in. No other endpoint ever sees the field.
        ...(settings.dialect === "kokoro" ? { allow_voice_tags: true } : {}),
      }),
      settings.apiKey.length > 0
        ? HttpClientRequest.setHeader("Authorization", `Bearer ${settings.apiKey}`)
        : (request) => request,
    );

    return yield* Effect.gen(function* () {
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
      const bytes = yield* response.arrayBuffer.pipe(
        Effect.map((buffer) => new Uint8Array(buffer)),
        Effect.mapError(
          (error) => new SpeechServiceError({ reason: "unavailable", detail: error.message }),
        ),
      );
      return { bytes, mimeType: responseMimeType(response.headers["content-type"]) };
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
  },
);
