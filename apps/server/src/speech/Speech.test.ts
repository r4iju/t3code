import * as NodeServices from "@effect/platform-node/NodeServices";
import { SPEECH_MAX_TOTAL_CHARS, type SpeechSettings } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as HttpClientError from "effect/unstable/http/HttpClientError";

import { ASSET_ROUTE_PREFIX, resolveAsset } from "../assets/AssetAccess.ts";
import * as NativeAppIconResolver from "../assets/NativeAppIconResolver.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as Speech from "./Speech.ts";

const configLayer = ServerConfig.layerTest(process.cwd(), { prefix: "t3-speech-test-" });
const baseLayer = Layer.mergeAll(
  configLayer,
  WorkspacePaths.layer,
  ProjectFaviconResolver.layer.pipe(
    Layer.provide(WorkspacePaths.layer),
    Layer.provide(T3ProjectFileLoader.layer),
  ),
  NativeAppIconResolver.layer.pipe(Layer.provide(configLayer)),
  ServerSecretStore.layer.pipe(Layer.provide(configLayer)),
).pipe(Layer.provideMerge(NodeServices.layer));

const settings: SpeechSettings = {
  baseUrl: "http://tts.test:8880/v1/",
  apiKey: "sk-test",
  model: "tts-1",
  voice: "alloy",
  maxCharsPerRequest: 4096,
};

const RequestBody = Schema.Struct({
  model: Schema.String,
  input: Schema.String,
  voice: Schema.String,
  response_format: Schema.String,
});
const decodeRequest = Schema.decodeUnknownSync(Schema.fromJsonString(RequestBody));
const text = new TextEncoder();
const decodeText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

interface RecordedRequest {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: typeof RequestBody.Type;
}

function fixture(options?: {
  readonly speech?: SpeechSettings | null;
  readonly respond?: (body: typeof RequestBody.Type) => Response;
  readonly unreachable?: boolean;
}) {
  const requests: RecordedRequest[] = [];
  const http = HttpClient.make((request) =>
    Effect.suspend(() => {
      const body =
        request.body._tag === "Uint8Array" ? decodeRequest(decodeText(request.body.body)) : null;
      if (!body) throw new Error("expected a JSON body");
      requests.push({ url: request.url, authorization: request.headers.authorization, body });
      if (options?.unreachable) {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: "ECONNREFUSED" }),
          }),
        );
      }
      const response =
        options?.respond?.(body) ??
        new Response(text.encode(`[${body.input}]`), {
          headers: { "content-type": "audio/mpeg" },
        });
      return Effect.succeed(HttpClientResponse.fromWeb(request, response));
    }),
  );
  const layer = Speech.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerSettings.layerTest({
          speech: options?.speech === undefined ? settings : options.speech,
        }),
        Layer.succeed(HttpClient.HttpClient, http),
      ),
    ),
    Layer.provideMerge(baseLayer),
  );
  return { requests, layer };
}

const readResult = (relativeUrl: string) =>
  Effect.gen(function* () {
    const suffix = relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
    const separator = suffix.indexOf("/");
    const asset = yield* resolveAsset(suffix.slice(0, separator), suffix.slice(separator + 1));
    expect(asset).not.toBeNull();
    const fs = yield* FileSystem.FileSystem;
    return { asset: asset!, contents: decodeText(yield* fs.readFile(asset!.path)) };
  });

describe("Speech", () => {
  it.effect("fails when read aloud is not configured", () =>
    Effect.gen(function* () {
      const speech = yield* Speech.Speech;
      const error = yield* Effect.flip(speech.synthesizeText("Hello there."));
      expect(error._tag).toBe("SpeechNotConfiguredError");
    }).pipe(Effect.provide(fixture({ speech: null }).layer)),
  );

  it.effect("synthesizes once, serves the cached file, and reuses it for repeat calls", () =>
    Effect.gen(function* () {
      const test = fixture();
      const speech = yield* Effect.provide(Speech.Speech, test.layer);
      const first = yield* speech.synthesizeText("Hello **there**.");
      expect(first.mimeType).toBe("audio/mpeg");
      const read = yield* readResult(first.relativeUrl);
      expect(read.asset).toEqual({ kind: "file", path: read.asset.path, mimeType: "audio/mpeg" });
      expect(read.contents).toBe("[Hello there.]");
      expect(test.requests).toHaveLength(1);
      expect(test.requests[0]!.url).toBe("http://tts.test:8880/v1/audio/speech");
      expect(test.requests[0]!.authorization).toBe("Bearer sk-test");
      expect(test.requests[0]!.body).toEqual({
        model: "tts-1",
        input: "Hello there.",
        voice: "alloy",
        response_format: "mp3",
      });

      const second = yield* speech.synthesizeText("Hello **there**.");
      expect((yield* readResult(second.relativeUrl)).contents).toBe("[Hello there.]");
      expect(test.requests).toHaveLength(1);
      // The hit touches the file for LRU order; a millisecond clock passed as
      // seconds would push it centuries into the future.
      const fs = yield* FileSystem.FileSystem;
      const touched = yield* fs.stat(read.asset.path);
      const mtime = Option.getOrThrow(touched.mtime);
      expect(mtime.getFullYear()).toBeLessThanOrEqual(new Date().getFullYear());

      const concurrent = yield* Effect.all(
        [speech.synthesizeText("Another line."), speech.synthesizeText("Another line.")],
        { concurrency: "unbounded" },
      );
      expect(concurrent[0]!.relativeUrl).toBe(concurrent[1]!.relativeUrl);
      expect(test.requests).toHaveLength(2);
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("synthesizes again for a different voice", () =>
    Effect.gen(function* () {
      const alloy = fixture();
      const nova = fixture({ speech: { ...settings, voice: "nova" } });
      const first = yield* Effect.provide(
        Effect.flatMap(Speech.Speech, (speech) => speech.synthesizeText("Same words.")),
        alloy.layer,
      );
      const second = yield* Effect.provide(
        Effect.flatMap(Speech.Speech, (speech) => speech.synthesizeText("Same words.")),
        nova.layer,
      );
      expect(first.relativeUrl).not.toBe(second.relativeUrl);
      expect(alloy.requests).toHaveLength(1);
      expect(nova.requests).toHaveLength(1);
      expect(nova.requests[0]!.body.voice).toBe("nova");
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("omits the Authorization header when no key is configured", () =>
    Effect.gen(function* () {
      const test = fixture({ speech: { ...settings, apiKey: "" } });
      yield* Effect.provide(
        Effect.flatMap(Speech.Speech, (speech) => speech.synthesizeText("Local model.")),
        test.layer,
      );
      expect(test.requests[0]!.authorization).toBeUndefined();
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("maps transport and status failures onto service error reasons", () =>
    Effect.gen(function* () {
      const attempt = (options: Parameters<typeof fixture>[0]) =>
        Effect.provide(
          Effect.flatMap(Speech.Speech, (speech) => Effect.flip(speech.synthesizeText("Hi."))),
          fixture(options).layer,
        );
      const status = (code: number, body = "") => ({
        respond: () => new Response(body, { status: code }),
      });
      expect(yield* attempt({ unreachable: true })).toMatchObject({
        _tag: "SpeechServiceError",
        reason: "unreachable",
      });
      expect(yield* attempt(status(401))).toMatchObject({ reason: "unauthorized" });
      expect(yield* attempt(status(403))).toMatchObject({ reason: "unauthorized" });
      expect(yield* attempt(status(429))).toMatchObject({ reason: "rate-limited" });
      expect(yield* attempt(status(500, "x".repeat(300)))).toMatchObject({
        reason: "unavailable",
        detail: `500 ${"x".repeat(200)}`,
      });
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("rejects code-only and oversized messages before contacting the service", () =>
    Effect.gen(function* () {
      const test = fixture();
      const speech = yield* Effect.provide(Speech.Speech, test.layer);
      expect((yield* Effect.flip(speech.synthesizeText("```\nls -la\n```")))._tag).toBe(
        "SpeechNothingToReadError",
      );
      const tooLong = yield* Effect.flip(
        speech.synthesizeText("word ".repeat(SPEECH_MAX_TOTAL_CHARS / 5 + 10)),
      );
      expect(tooLong).toMatchObject({ _tag: "SpeechTooLongError", limit: SPEECH_MAX_TOTAL_CHARS });
      expect(test.requests).toHaveLength(0);
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("chunks long text into sequential requests and one file in order", () =>
    Effect.gen(function* () {
      const test = fixture({ speech: { ...settings, maxCharsPerRequest: 200 } });
      const speech = yield* Effect.provide(Speech.Speech, test.layer);
      const paragraphs = Array.from(
        { length: 6 },
        (_, index) => `Paragraph ${index} ${"lorem ipsum ".repeat(6)}ends here.`,
      );
      const result = yield* speech.synthesizeText(paragraphs.join("\n\n"));
      expect(test.requests.length).toBeGreaterThan(1);
      const expected = test.requests.map((request) => `[${request.body.input}]`).join("");
      expect((yield* readResult(result.relativeUrl)).contents).toBe(expected);
      for (const paragraph of paragraphs) expect(expected).toContain(paragraph);
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("trims the least recently used files once the cache exceeds its cap", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const names = ["a", "b", "c"].map((letter) => `${letter.repeat(64)}.mp3`);
      for (const [index, name] of names.entries()) {
        const filePath = path.join(config.speechDir, name);
        yield* fs.writeFile(filePath, new Uint8Array(100));
        yield* fs.utimes(filePath, 1_000_000 * (index + 1), 1_000_000 * (index + 1));
      }
      yield* fs.writeFileString(path.join(config.speechDir, "notes.txt"), "keep");

      yield* Speech.trimSpeechCache(config.speechDir, 250);

      const remaining = (yield* fs.readDirectory(config.speechDir)).sort();
      expect(remaining).toEqual([names[1], names[2], "notes.txt"].sort());
    }).pipe(Effect.provide(baseLayer)),
  );
});
