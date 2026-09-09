/**
 * Summarizes one Markdown table into a sentence or two for read aloud, against
 * an OpenAI-shaped `/chat/completions` endpoint. Intended for a local model, so
 * there is no key and the timeout is short: this runs while someone is
 * listening, and the caller always has a spoken reading to fall back on.
 *
 * Every failure returns null. A summary is a nicety, never a reason for read
 * aloud to fail.
 */
import {
  SPEECH_SUMMARY_REASONING_EFFORT,
  SPEECH_SUMMARY_TIMEOUT_MS,
  type SpeechSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

/**
 * Asking for spoken prose keeps Markdown out of the answer, and forbidding
 * unseen numbers is the one guard against a summary inventing a figure the
 * listener cannot check against the table.
 */
const PROMPT_PREFIX =
  "Summarize this Markdown table in one or two sentences to be read aloud. " +
  "Say what the table is about and only the facts that matter. " +
  "Write plain prose: no Markdown, no lists, no headings. " +
  "Never state a number that does not appear in the table.\n\n";

/** Enough for two sentences; a model that runs past it is not summarizing. */
const MAX_SUMMARY_TOKENS = 160;
const MAX_SUMMARY_CHARS = 800;

export const summarizeTable = Effect.fn("TableSummaryClient.summarizeTable")(function* (
  settings: SpeechSettings,
  table: string,
): Effect.fn.Return<string | null, never, HttpClient.HttpClient> {
  const baseUrl = settings.summaryBaseUrl.trim();
  const model = settings.summaryModel.trim();
  if (baseUrl.length === 0 || model.length === 0) return null;
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.post(`${baseUrl.replace(/\/+$/, "")}/chat/completions`).pipe(
    HttpClientRequest.bodyJsonUnsafe({
      model,
      messages: [{ role: "user", content: `${PROMPT_PREFIX}${table}` }],
      temperature: 0.2,
      max_tokens: MAX_SUMMARY_TOKENS,
      stream: false,
      // Without this a thinking model spends its whole budget reasoning and
      // answers with empty content, which reads as success.
      reasoning_effort: SPEECH_SUMMARY_REASONING_EFFORT,
    }),
  );

  return yield* Effect.gen(function* () {
    const response = yield* client.execute(request);
    if (response.status < 200 || response.status >= 300) return null;
    const body = yield* response.json;
    const content = (body as { choices?: ReadonlyArray<{ message?: { content?: unknown } }> })
      .choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const summary = content.trim();
    return summary.length === 0 || summary.length > MAX_SUMMARY_CHARS ? null : summary;
  }).pipe(
    Effect.timeoutOption(SPEECH_SUMMARY_TIMEOUT_MS),
    Effect.map((option) => (option._tag === "Some" ? option.value : null)),
    Effect.orElseSucceed(() => null),
  );
});
