import {
  SPEECH_DEFAULT_BASE_URL,
  SPEECH_DEFAULT_CJK_VOICE,
  SPEECH_DEFAULT_DIALECT,
  SPEECH_DEFAULT_MAX_CHARS_PER_REQUEST,
  SPEECH_DEFAULT_MODEL,
  SPEECH_DEFAULT_VOICE,
  SPEECH_MAX_TOTAL_CHARS,
  type SpeechDialect,
  type SpeechSettings,
} from "@t3tools/contracts";

/** What the server sends in place of a stored key; sending it back keeps the key. */
export const SPEECH_API_KEY_SENTINEL = "••••••";
export const SPEECH_MIN_CHARS_PER_REQUEST = 200;

export interface ReadAloudFormValues {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly voice: string;
  readonly maxCharsPerRequest: string;
  readonly dialect: SpeechDialect;
  readonly cjkVoice: string;
  readonly summaryBaseUrl: string;
  readonly summaryModel: string;
}

export type ReadAloudFormErrors = Partial<Record<keyof ReadAloudFormValues, string>>;

export type ReadAloudPreset = "openai" | "local";

export const READ_ALOUD_PRESET_LABELS: Record<ReadAloudPreset, string> = {
  openai: "OpenAI",
  local: "Local server",
};

export function defaultSpeechSettings(): SpeechSettings {
  return {
    baseUrl: SPEECH_DEFAULT_BASE_URL,
    apiKey: "",
    model: SPEECH_DEFAULT_MODEL,
    voice: SPEECH_DEFAULT_VOICE,
    maxCharsPerRequest: SPEECH_DEFAULT_MAX_CHARS_PER_REQUEST,
    dialect: SPEECH_DEFAULT_DIALECT,
    cjkVoice: SPEECH_DEFAULT_CJK_VOICE,
    summaryBaseUrl: "",
    summaryModel: "",
  };
}

export function readAloudFormFromSettings(settings: SpeechSettings): ReadAloudFormValues {
  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    voice: settings.voice,
    maxCharsPerRequest: String(settings.maxCharsPerRequest),
    dialect: settings.dialect,
    cjkVoice: settings.cjkVoice,
    summaryBaseUrl: settings.summaryBaseUrl,
    summaryModel: settings.summaryModel,
  };
}

/**
 * Presets only prefill the endpoint fields. OpenAI keeps whatever key is in
 * the form since the user has to supply their own; the local preset clears it
 * because local servers run unauthenticated.
 */
export function applyReadAloudPreset(
  form: ReadAloudFormValues,
  preset: ReadAloudPreset,
): ReadAloudFormValues {
  switch (preset) {
    case "openai":
      return {
        ...form,
        baseUrl: SPEECH_DEFAULT_BASE_URL,
        model: SPEECH_DEFAULT_MODEL,
        voice: SPEECH_DEFAULT_VOICE,
        maxCharsPerRequest: String(SPEECH_DEFAULT_MAX_CHARS_PER_REQUEST),
        dialect: "plain",
        cjkVoice: "",
      };
    case "local":
      return {
        baseUrl: "http://localhost:8880/v1",
        apiKey: "",
        model: "kokoro",
        voice: "af_bella",
        maxCharsPerRequest: String(SPEECH_DEFAULT_MAX_CHARS_PER_REQUEST),
        dialect: "kokoro",
        cjkVoice: SPEECH_DEFAULT_CJK_VOICE,
        // The summarizer is a separate endpoint; a speech preset has no say in it.
        summaryBaseUrl: form.summaryBaseUrl,
        summaryModel: form.summaryModel,
      };
  }
}

export function isReadAloudFormDirty(form: ReadAloudFormValues, saved: SpeechSettings): boolean {
  const savedForm = readAloudFormFromSettings(saved);
  return (
    form.baseUrl.trim() !== savedForm.baseUrl ||
    form.apiKey.trim() !== savedForm.apiKey ||
    form.model.trim() !== savedForm.model ||
    form.voice.trim() !== savedForm.voice ||
    form.maxCharsPerRequest.trim() !== savedForm.maxCharsPerRequest ||
    form.dialect !== savedForm.dialect ||
    form.cjkVoice.trim() !== savedForm.cjkVoice ||
    form.summaryBaseUrl.trim() !== savedForm.summaryBaseUrl ||
    form.summaryModel.trim() !== savedForm.summaryModel
  );
}

export function validateReadAloudForm(
  form: ReadAloudFormValues,
):
  | { readonly ok: true; readonly settings: SpeechSettings }
  | { readonly ok: false; readonly errors: ReadAloudFormErrors } {
  const errors: Record<string, string> = {};
  const baseUrl = form.baseUrl.trim();
  if (baseUrl.length === 0) {
    errors.baseUrl = "Enter the speech API base URL.";
  } else {
    let protocol: string | null = null;
    try {
      protocol = new URL(baseUrl).protocol;
    } catch {
      protocol = null;
    }
    if (protocol !== "http:" && protocol !== "https:") {
      errors.baseUrl = "Enter an http:// or https:// URL.";
    }
  }
  const model = form.model.trim();
  if (model.length === 0) errors.model = "Enter a model name.";
  const voice = form.voice.trim();
  if (voice.length === 0) errors.voice = "Enter a voice name.";
  const maxCharsText = form.maxCharsPerRequest.trim();
  const maxCharsPerRequest = /^\d+$/.test(maxCharsText) ? Number(maxCharsText) : Number.NaN;
  if (
    !Number.isInteger(maxCharsPerRequest) ||
    maxCharsPerRequest < SPEECH_MIN_CHARS_PER_REQUEST ||
    maxCharsPerRequest > SPEECH_MAX_TOTAL_CHARS
  ) {
    errors.maxCharsPerRequest = `Enter a whole number between ${SPEECH_MIN_CHARS_PER_REQUEST} and ${SPEECH_MAX_TOTAL_CHARS}.`;
  }
  // Both or neither: a URL without a model silently summarizes nothing.
  const summaryBaseUrl = form.summaryBaseUrl.trim();
  const summaryModel = form.summaryModel.trim();
  if (summaryBaseUrl.length > 0) {
    let summaryProtocol: string | null = null;
    try {
      summaryProtocol = new URL(summaryBaseUrl).protocol;
    } catch {
      summaryProtocol = null;
    }
    if (summaryProtocol !== "http:" && summaryProtocol !== "https:") {
      errors.summaryBaseUrl = "Enter an http:// or https:// URL.";
    } else if (summaryModel.length === 0) {
      errors.summaryModel = "Enter the model that summarizes tables, or clear the URL.";
    }
  } else if (summaryModel.length > 0) {
    errors.summaryBaseUrl = "Enter the summarizer URL, or clear the model.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      baseUrl,
      apiKey: form.apiKey.trim(),
      model,
      voice,
      maxCharsPerRequest,
      dialect: form.dialect,
      // Only the Kokoro dialect can route a run to another voice, so a value
      // left over from switching back never reaches the endpoint.
      cjkVoice: form.dialect === "kokoro" ? form.cjkVoice.trim() : "",
      summaryBaseUrl,
      summaryModel,
    },
  };
}

/** The enable switch writes a whole block: defaults when turning on, null when turning off. */
export function readAloudEnabledPatch(enabled: boolean): {
  readonly speech: SpeechSettings | null;
} {
  return { speech: enabled ? defaultSpeechSettings() : null };
}
