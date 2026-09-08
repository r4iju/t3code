import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { concatenateSpeechAudio } from "./speechAudio.ts";

const text = new TextEncoder();

function wav(
  samples: ReadonlyArray<number>,
  options?: { sampleRate?: number; unknownLength?: boolean },
) {
  const fmt = new Uint8Array(16);
  const fmtView = new DataView(fmt.buffer);
  fmtView.setUint16(0, 1, true); // PCM
  fmtView.setUint16(2, 1, true); // mono
  fmtView.setUint32(4, options?.sampleRate ?? 8000, true);
  fmtView.setUint32(8, (options?.sampleRate ?? 8000) * 2, true);
  fmtView.setUint16(12, 2, true);
  fmtView.setUint16(14, 16, true);
  const data = new Uint8Array(samples.length * 2);
  const dataView = new DataView(data.buffer);
  samples.forEach((sample, index) => dataView.setInt16(index * 2, sample, true));
  const out = new Uint8Array(44 + data.byteLength);
  const view = new DataView(out.buffer);
  out.set(text.encode("RIFF"), 0);
  view.setUint32(4, 36 + data.byteLength, true);
  out.set(text.encode("WAVE"), 8);
  out.set(text.encode("fmt "), 12);
  view.setUint32(16, 16, true);
  out.set(fmt, 20);
  out.set(text.encode("data"), 36);
  view.setUint32(40, options?.unknownLength ? 0xffffffff : data.byteLength, true);
  out.set(data, 44);
  return out;
}

const fail = (chunks: Parameters<typeof concatenateSpeechAudio>[0]) =>
  Effect.flip(concatenateSpeechAudio(chunks));

describe("concatenateSpeechAudio", () => {
  it.effect("passes a single chunk through and names its extension", () =>
    Effect.gen(function* () {
      const result = yield* concatenateSpeechAudio([
        { bytes: text.encode("opus"), mimeType: "audio/ogg" },
      ]);
      expect(result).toEqual({
        bytes: text.encode("opus"),
        mimeType: "audio/ogg",
        extension: "ogg",
      });
    }),
  );

  it.effect("appends mp3 chunks in order", () =>
    Effect.gen(function* () {
      const result = yield* concatenateSpeechAudio([
        { bytes: text.encode("one"), mimeType: "audio/mpeg" },
        { bytes: text.encode("two"), mimeType: "audio/mp3" },
      ]);
      expect(result.extension).toBe("mp3");
      expect(new TextDecoder().decode(result.bytes)).toBe("onetwo");
    }),
  );

  it.effect("joins wav chunks under a single header with the combined data length", () =>
    Effect.gen(function* () {
      const result = yield* concatenateSpeechAudio([
        { bytes: wav([1, 2]), mimeType: "audio/wav" },
        { bytes: wav([3], { unknownLength: true }), mimeType: "audio/x-wav" },
      ]);
      expect(result.extension).toBe("wav");
      expect(result.bytes).toEqual(wav([1, 2, 3]));
    }),
  );

  it.effect("refuses wav chunks with different sample formats", () =>
    Effect.gen(function* () {
      const error = yield* fail([
        { bytes: wav([1]), mimeType: "audio/wav" },
        { bytes: wav([2], { sampleRate: 16000 }), mimeType: "audio/wav" },
      ]);
      expect(error.reason).toBe("unsupported-format");
    }),
  );

  it.effect("refuses to join formats that cannot be appended and unknown types", () =>
    Effect.gen(function* () {
      const ogg = yield* fail([
        { bytes: text.encode("a"), mimeType: "audio/ogg" },
        { bytes: text.encode("b"), mimeType: "audio/ogg" },
      ]);
      expect(ogg.reason).toBe("unsupported-format");
      const html = yield* fail([{ bytes: text.encode("a"), mimeType: "text/html" }]);
      expect(html.reason).toBe("unsupported-format");
      const empty = yield* fail([]);
      expect(empty.reason).toBe("unsupported-format");
    }),
  );
});
