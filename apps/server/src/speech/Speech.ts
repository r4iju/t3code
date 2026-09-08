/**
 * Speech — read-aloud synthesis owned by the environment.
 *
 * Turns assistant Markdown into audio via the configured OpenAI-shaped
 * endpoint, caches the result under a content hash in `speechDir`, and hands
 * back a signed asset URL. The cache is a size-capped LRU keyed on everything
 * that changes the sound (endpoint, model, voice, prepared text), so replaying
 * a message never costs a second request.
 *
 * @module speech/Speech
 */
import {
  SPEECH_MAX_TOTAL_CHARS,
  SpeechCacheError,
  SpeechEnvironmentError,
  SpeechNotConfiguredError,
  SpeechNothingToReadError,
  SpeechTooLongError,
  type SpeechSynthesizeError,
  type SpeechSynthesizeResult,
} from "@t3tools/contracts";
import { prepareSpeechText, splitSpeechText } from "@t3tools/shared/speechText";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/unstable/http";

import { issueAssetUrl, speechCacheKeyMimeType } from "../assets/AssetAccess.ts";
import { writeFileAtomically } from "../atomicWrite.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { synthesizeSpeechChunk } from "./OpenAiSpeechClient.ts";
import { concatenateSpeechAudio, type SpeechAudioExtension } from "./speechAudio.ts";

export class Speech extends Context.Service<
  Speech,
  {
    /** Speaks Markdown from an assistant message (or the sample sentence). */
    readonly synthesizeText: (
      text: string,
    ) => Effect.Effect<SpeechSynthesizeResult, SpeechSynthesizeError>;
  }
>()("t3/speech/Speech") {}

export const SPEECH_CACHE_MAX_BYTES = 200 * 1024 * 1024;
const CACHE_EXTENSIONS: ReadonlyArray<SpeechAudioExtension> = [
  "mp3",
  "wav",
  "ogg",
  "aac",
  "flac",
  "webm",
];

const textEncoder = new TextEncoder();

/**
 * Deletes least-recently-used files until the directory fits the cap. Runs
 * after every write, so it only ever has a file or two to remove.
 */
export const trimSpeechCache = Effect.fn("Speech.trimSpeechCache")(function* (
  speechDir: string,
  maxBytes: number,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fs.readDirectory(speechDir);
  const entries: Array<{
    readonly filePath: string;
    readonly size: number;
    readonly mtime: number;
  }> = [];
  for (const name of names) {
    if (speechCacheKeyMimeType(name) === null) continue;
    const filePath = path.join(speechDir, name);
    const info = yield* fs.stat(filePath).pipe(Effect.option);
    if (Option.isNone(info) || info.value.type !== "File") continue;
    entries.push({
      filePath,
      size: Number(info.value.size),
      mtime: Option.map(info.value.mtime, (date) => date.getTime()).pipe(Option.getOrElse(() => 0)),
    });
  }
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  entries.sort((a, b) => a.mtime - b.mtime);
  for (const entry of entries) {
    if (total <= maxBytes) break;
    yield* fs.remove(entry.filePath).pipe(Effect.ignore);
    total -= entry.size;
  }
});

export const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettingsService;
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  // Signing a URL reaches into the same services the asset route uses;
  // capturing them here keeps `synthesizeText` free of requirements.
  const assetContext = yield* Effect.context<
    | ServerConfig.ServerConfig
    | FileSystem.FileSystem
    | Path.Path
    | Crypto.Crypto
    | HttpClient.HttpClient
    | ServerSecretStore.ServerSecretStore
    | WorkspacePaths.WorkspacePaths
    | ProjectFaviconResolver.ProjectFaviconResolver
  >();

  const cacheError = (cause: unknown) => new SpeechCacheError({ cause });

  // Two plays of the same message wait on one synthesis instead of racing.
  const inflight = new Map<string, { readonly lock: Semaphore.Semaphore; count: number }>();
  const withKeyLock = <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const entry = inflight.get(key) ?? { lock: Semaphore.makeUnsafe(1), count: 0 };
        entry.count += 1;
        inflight.set(key, entry);
        return entry;
      }),
      (entry) => entry.lock.withPermits(1)(effect),
      (entry) =>
        Effect.sync(() => {
          entry.count -= 1;
          if (entry.count === 0) inflight.delete(key);
        }),
    );

  const findCached = Effect.fn("Speech.findCached")(function* (hash: string) {
    for (const extension of CACHE_EXTENSIONS) {
      const cacheKey = `${hash}.${extension}`;
      const info = yield* fs.stat(path.join(config.speechDir, cacheKey)).pipe(Effect.option);
      if (Option.isSome(info) && info.value.type === "File") return cacheKey;
    }
    return null;
  });

  const issueResult = Effect.fn("Speech.issueResult")(function* (cacheKey: string) {
    const issued = yield* issueAssetUrl({ resource: { _tag: "speech", cacheKey } }).pipe(
      Effect.mapError(cacheError),
    );
    return {
      relativeUrl: issued.relativeUrl,
      expiresAt: issued.expiresAt,
      mimeType: speechCacheKeyMimeType(cacheKey) ?? "audio/mpeg",
    } satisfies SpeechSynthesizeResult;
  });

  const synthesizeText = Effect.fn("Speech.synthesizeText")(function* (
    text: string,
  ): Effect.fn.Return<SpeechSynthesizeResult, SpeechSynthesizeError> {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError((cause) => new SpeechEnvironmentError({ cause })),
    );
    const speech = settings.speech;
    if (speech === null) return yield* new SpeechNotConfiguredError();
    const prepared = prepareSpeechText(text);
    if (prepared.length === 0) return yield* new SpeechNothingToReadError();
    if (prepared.length > SPEECH_MAX_TOTAL_CHARS) {
      return yield* new SpeechTooLongError({
        characters: prepared.length,
        limit: SPEECH_MAX_TOTAL_CHARS,
      });
    }
    const hash = yield* crypto
      .digest(
        "SHA-256",
        textEncoder.encode(`${speech.baseUrl}\n${speech.model}\n${speech.voice}\n${prepared}`),
      )
      .pipe(Effect.map(Encoding.encodeHex), Effect.mapError(cacheError));

    return yield* withKeyLock(
      hash,
      Effect.gen(function* () {
        const cached = yield* findCached(hash).pipe(Effect.mapError(cacheError));
        if (cached !== null) {
          const now = yield* Clock.currentTimeMillis;
          // Node reads bare numbers as seconds, so convert the millisecond clock.
          const touchedAt = now / 1000;
          yield* fs
            .utimes(path.join(config.speechDir, cached), touchedAt, touchedAt)
            .pipe(Effect.ignore);
          return yield* issueResult(cached);
        }
        const chunks = yield* Effect.forEach(
          splitSpeechText(prepared, speech.maxCharsPerRequest),
          (chunk) => synthesizeSpeechChunk(speech, chunk),
        );
        const audio = yield* concatenateSpeechAudio(chunks);
        const cacheKey = `${hash}.${audio.extension}`;
        yield* writeFileAtomically({
          filePath: path.join(config.speechDir, cacheKey),
          contents: audio.bytes,
        }).pipe(Effect.mapError(cacheError));
        yield* trimSpeechCache(config.speechDir, SPEECH_CACHE_MAX_BYTES).pipe(Effect.ignore);
        return yield* issueResult(cacheKey);
      }),
    ).pipe(Effect.provideContext(assetContext));
  });

  return Speech.of({ synthesizeText });
});

export const layer = Layer.effect(Speech, make);
