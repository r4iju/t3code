import {
  SPEECH_DEFAULT_BASE_URL,
  SPEECH_DEFAULT_CJK_VOICE,
  SPEECH_DEFAULT_DIALECT,
  SPEECH_DEFAULT_MAX_CHARS_PER_REQUEST,
  SPEECH_DEFAULT_MODEL,
  SPEECH_DEFAULT_PROVIDER,
  SPEECH_DEFAULT_VOICE,
  SPEECH_GEMINI_BASE_URL,
  SPEECH_GEMINI_MODEL,
  SPEECH_GEMINI_VOICE,
  SPEECH_MAX_TOTAL_CHARS,
  type SpeechDialect,
  type SpeechProvider,
  type SpeechSettings,
} from "@t3tools/contracts";

/**
 * What the server sends in place of a stored key, followed by its last four
 * characters; sending it back keeps that key.
 */
export const SPEECH_API_KEY_SENTINEL = "••••••";
export const SPEECH_MIN_CHARS_PER_REQUEST = 200;

export interface ReadAloudFormValues {
  readonly provider: SpeechProvider;
  readonly baseUrl: string;
  /** One input per account; blank inputs are dropped on save. */
  readonly apiKeys: ReadonlyArray<string>;
  readonly model: string;
  readonly voice: string;
  readonly maxCharsPerRequest: string;
  readonly dialect: SpeechDialect;
  readonly cjkVoice: string;
  readonly summaryBaseUrl: string;
  readonly summaryModel: string;
}

export type ReadAloudFormErrors = Partial<Record<keyof ReadAloudFormValues, string>>;

export type ReadAloudPreset = "openai" | "gemini" | "local";

export const READ_ALOUD_PRESET_LABELS: Record<ReadAloudPreset, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  local: "Local server",
};

export function defaultSpeechSettings(): SpeechSettings {
  return {
    provider: SPEECH_DEFAULT_PROVIDER,
    baseUrl: SPEECH_DEFAULT_BASE_URL,
    apiKeys: [],
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
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    // An empty list still shows one input to type into.
    apiKeys: settings.apiKeys.length > 0 ? settings.apiKeys : [""],
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
 * Presets only prefill the endpoint fields. The cloud presets keep whatever
 * keys are in the form since the user has to supply their own; the local preset
 * clears them because local servers run unauthenticated.
 */
export function applyReadAloudPreset(
  form: ReadAloudFormValues,
  preset: ReadAloudPreset,
): ReadAloudFormValues {
  switch (preset) {
    case "openai":
      return {
        ...form,
        provider: "openai",
        baseUrl: SPEECH_DEFAULT_BASE_URL,
        model: SPEECH_DEFAULT_MODEL,
        voice: SPEECH_DEFAULT_VOICE,
        maxCharsPerRequest: String(SPEECH_DEFAULT_MAX_CHARS_PER_REQUEST),
        dialect: "plain",
        cjkVoice: "",
      };
    case "gemini":
      return {
        ...form,
        provider: "gemini",
        baseUrl: SPEECH_GEMINI_BASE_URL,
        model: SPEECH_GEMINI_MODEL,
        voice: SPEECH_GEMINI_VOICE,
        maxCharsPerRequest: String(SPEECH_DEFAULT_MAX_CHARS_PER_REQUEST),
        dialect: "plain",
        cjkVoice: "",
      };
    case "local":
      return {
        provider: "openai",
        baseUrl: "http://localhost:8880/v1",
        apiKeys: [""],
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

function formApiKeys(form: ReadAloudFormValues): ReadonlyArray<string> {
  return form.apiKeys.map((key) => key.trim()).filter((key) => key.length > 0);
}

function sameKeys(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

export function isReadAloudFormDirty(form: ReadAloudFormValues, saved: SpeechSettings): boolean {
  const savedForm = readAloudFormFromSettings(saved);
  return (
    form.provider !== savedForm.provider ||
    form.baseUrl.trim() !== savedForm.baseUrl ||
    !sameKeys(formApiKeys(form), saved.apiKeys) ||
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
  const apiKeys = formApiKeys(form);
  if (form.provider === "gemini" && apiKeys.length === 0) {
    errors.apiKeys = "Gemini needs an API key.";
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
      provider: form.provider,
      baseUrl,
      apiKeys,
      model,
      voice,
      maxCharsPerRequest,
      // Kokoro markers mean nothing to Gemini, which would speak them.
      dialect: form.provider === "gemini" ? "plain" : form.dialect,
      // Only the Kokoro dialect can route a run to another voice, so a value
      // left over from switching back never reaches the endpoint.
      cjkVoice: form.provider === "openai" && form.dialect === "kokoro" ? form.cjkVoice.trim() : "",
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
