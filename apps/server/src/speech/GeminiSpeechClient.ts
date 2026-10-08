/**
 * One request against Gemini's `/interactions` API with a TTS model. The audio
 * comes back base64-encoded inside the JSON, as 24 kHz WAV unless asked
 * otherwise.
 */
import type { SpeechSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClientRequest } from "effect/http";

import { sendSpeechRequest, type SpeechAudioChunk, unavailable } from "./speechRequest.ts";

const Interaction = Schema.Struct({
  steps: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      content: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            type: Schema.String,
            data: Schema.optionalKey(Schema.String),
            mime_type: Schema.optionalKey(Schema.String),
          }),
        ),
      ),
    }),
  ),
});
const decodeInteraction = Schema.decodeUnknownEffect(Interaction);

export const synthesizeSpeechChunk = Effect.fn("GeminiSpeechClient.synthesizeSpeechChunk")(
  function* (settings: SpeechSettings, apiKey: string, input: string) {
    const url = `${settings.baseUrl.replace(/\/+$/, "")}/interactions`;
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        model: settings.model,
        input: [{ type: "user_input", content: [{ type: "text", text: input }] }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice: settings.voice }] },
      }),
      HttpClientRequest.setHeader("x-goog-api-key", apiKey),
    );
    return yield* sendSpeechRequest(request, (response) =>
      Effect.gen(function* () {
        const interaction = yield* response.json.pipe(
          Effect.flatMap(decodeInteraction),
          Effect.mapError((error) => unavailable(error.message)),
        );
        const audio = interaction.steps
          .filter((step) => step.type === "model_output")
          .flatMap((step) => step.content ?? [])
          .findLast((content) => content.type === "audio" && content.data !== undefined);
        if (audio?.data === undefined) return yield* unavailable("The response held no audio.");
        const bytes = Base64.decode(audio.data);
        if (Result.isFailure(bytes)) return yield* unavailable("The audio was not valid base64.");
        return {
          bytes: bytes.success,
          mimeType: audio.mime_type?.toLowerCase() ?? "audio/wav",
        } satisfies SpeechAudioChunk;
      }),
    );
  },
);
