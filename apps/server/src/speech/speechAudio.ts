/**
 * Stitches per-chunk audio into one file. MP3 frames concatenate as-is; WAV
 * needs one header over the combined samples. Anything else is served
 * untouched when there is a single chunk and refused otherwise, because
 * container formats cannot be joined by appending bytes.
 */
import { SpeechServiceError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { SpeechAudioChunk } from "./OpenAiSpeechClient.ts";

export type SpeechAudioExtension = "mp3" | "wav" | "ogg" | "aac" | "flac" | "webm";

export interface SpeechAudio {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly extension: SpeechAudioExtension;
}

const EXTENSION_BY_MIME_TYPE: Record<string, SpeechAudioExtension> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mpeg3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/aac": "aac",
  "audio/x-aac": "aac",
  "audio/mp4": "aac",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/webm": "webm",
};

const unsupported = (detail: string) =>
  new SpeechServiceError({ reason: "unsupported-format", detail });

function concatBytes(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

const ascii = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);

interface WavChunks {
  readonly fmt: Uint8Array;
  readonly data: Uint8Array;
}

/** Walks the RIFF chunk list; a streaming writer may leave the data size unknown. */
function readWav(bytes: Uint8Array): WavChunks | null {
  if (bytes.byteLength < 12 || ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE") {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: Uint8Array | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset);
    const declared = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const available = bytes.byteLength - start;
    if (id === "data") {
      const length =
        declared === 0 || declared === 0xffffffff ? available : Math.min(declared, available);
      return fmt ? { fmt, data: bytes.subarray(start, start + length) } : null;
    }
    if (declared > available) return null;
    if (id === "fmt ") fmt = bytes.subarray(start, start + declared);
    offset = start + declared + (declared % 2);
  }
  return null;
}

function writeWav(fmt: Uint8Array, data: ReadonlyArray<Uint8Array>): Uint8Array {
  const dataLength = data.reduce((total, part) => total + part.byteLength, 0);
  const fmtPadding = fmt.byteLength % 2;
  const header = new Uint8Array(12 + 8 + fmt.byteLength + fmtPadding + 8);
  const view = new DataView(header.buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < 4; index += 1) header[offset + index] = text.charCodeAt(index);
  };
  write(0, "RIFF");
  view.setUint32(4, header.byteLength - 8 + dataLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, fmt.byteLength, true);
  header.set(fmt, 20);
  const dataOffset = 20 + fmt.byteLength + fmtPadding;
  write(dataOffset, "data");
  view.setUint32(dataOffset + 4, dataLength, true);
  return concatBytes([header, ...data]);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

export function concatenateSpeechAudio(
  chunks: ReadonlyArray<SpeechAudioChunk>,
): Effect.Effect<SpeechAudio, SpeechServiceError> {
  const first = chunks[0];
  if (!first) return unsupported("The speech service returned no audio.");
  const mimeType = first.mimeType;
  const extension = EXTENSION_BY_MIME_TYPE[mimeType];
  if (extension === undefined) return unsupported(`Unknown audio type "${mimeType}".`);
  if (chunks.some((chunk) => EXTENSION_BY_MIME_TYPE[chunk.mimeType] !== extension)) {
    return unsupported("The speech service changed audio type between chunks.");
  }
  if (chunks.length === 1) {
    return Effect.succeed({ bytes: first.bytes, mimeType, extension });
  }
  if (extension === "mp3") {
    return Effect.succeed({
      bytes: concatBytes(chunks.map((chunk) => chunk.bytes)),
      mimeType,
      extension,
    });
  }
  if (extension === "wav") {
    const parsed: WavChunks[] = [];
    for (const chunk of chunks) {
      const wav = readWav(chunk.bytes);
      if (!wav) return unsupported("A WAV chunk had no readable header.");
      parsed.push(wav);
    }
    const fmt = parsed[0]!.fmt;
    if (parsed.some((wav) => !sameBytes(wav.fmt, fmt))) {
      return unsupported("WAV chunks used different sample formats.");
    }
    return Effect.succeed({
      bytes: writeWav(
        fmt,
        parsed.map((wav) => wav.data),
      ),
      mimeType,
      extension,
    });
  }
  return unsupported(`Cannot join multiple "${mimeType}" chunks.`);
}
