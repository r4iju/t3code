/**
 * One request against an OpenAI-shaped `/audio/speech` endpoint. Any server
 * that speaks that shape works, cloud or local, which is why the base URL and
 * an optional key are all the configuration there is.
 */
import type { SpeechSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClientRequest } from "effect/unstable/http";

import { sendSpeechRequest, type SpeechAudioChunk, unavailable } from "./speechRequest.ts";

const DEFAULT_MIME_TYPE = "audio/mpeg";

function responseMimeType(contentType: string | undefined): string {
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  // We asked for mp3; a server that does not label its bytes is sending that.
  return mimeType.length === 0 || mimeType === "application/octet-stream"
    ? DEFAULT_MIME_TYPE
    : mimeType;
}

export const synthesizeSpeechChunk = Effect.fn("OpenAiSpeechClient.synthesizeSpeechChunk")(
  function* (settings: SpeechSettings, input: string) {
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
    return yield* sendSpeechRequest(request, (response) =>
      response.arrayBuffer.pipe(
        Effect.map((buffer): SpeechAudioChunk => ({
          bytes: new Uint8Array(buffer),
          mimeType: responseMimeType(response.headers["content-type"]),
        })),
        Effect.mapError((error) => unavailable(error.message)),
      ),
    );
  },
);
