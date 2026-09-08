import {
  SPEECH_DEFAULT_BASE_URL,
  SPEECH_DEFAULT_MAX_CHARS_PER_REQUEST,
  SPEECH_DEFAULT_MODEL,
  SPEECH_DEFAULT_VOICE,
  SPEECH_MAX_TOTAL_CHARS,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyReadAloudPreset,
  defaultSpeechSettings,
  isReadAloudFormDirty,
  readAloudEnabledPatch,
  readAloudFormFromSettings,
  SPEECH_API_KEY_SENTINEL,
  validateReadAloudForm,
} from "./ReadAloudSettings.logic";

const savedSettings = {
  baseUrl: "https://tts.example.com/v1",
  apiKey: SPEECH_API_KEY_SENTINEL,
  model: "tts-1",
  voice: "nova",
  maxCharsPerRequest: 1000,
};

describe("presets", () => {
  it("OpenAI prefills the endpoint fields and keeps the entered key", () => {
    const form = applyReadAloudPreset(readAloudFormFromSettings(savedSettings), "openai");
    expect(form).toEqual({
      baseUrl: SPEECH_DEFAULT_BASE_URL,
      apiKey: SPEECH_API_KEY_SENTINEL,
      model: SPEECH_DEFAULT_MODEL,
      voice: SPEECH_DEFAULT_VOICE,
      maxCharsPerRequest: String(SPEECH_DEFAULT_MAX_CHARS_PER_REQUEST),
    });
  });

  it("Local server points at a Kokoro-style endpoint without a key", () => {
    const form = applyReadAloudPreset(readAloudFormFromSettings(savedSettings), "local");
    expect(form).toEqual({
      baseUrl: "http://localhost:8880/v1",
      apiKey: "",
      model: "kokoro",
      voice: "af_bella",
      maxCharsPerRequest: String(SPEECH_DEFAULT_MAX_CHARS_PER_REQUEST),
    });
  });
});

describe("patches", () => {
  it("turning on writes the default block and turning off writes null", () => {
    expect(readAloudEnabledPatch(true)).toEqual({ speech: defaultSpeechSettings() });
    expect(readAloudEnabledPatch(false)).toEqual({ speech: null });
    expect(defaultSpeechSettings().apiKey).toBe("");
  });

  it("a valid form becomes a trimmed whole speech block", () => {
    const result = validateReadAloudForm({
      baseUrl: " https://tts.example.com/v1 ",
      apiKey: " sk-test ",
      model: " tts-1 ",
      voice: " nova ",
      maxCharsPerRequest: " 1500 ",
    });
    expect(result).toEqual({
      ok: true,
      settings: {
        baseUrl: "https://tts.example.com/v1",
        apiKey: "sk-test",
        model: "tts-1",
        voice: "nova",
        maxCharsPerRequest: 1500,
      },
    });
  });

  it("leaving the redacted key untouched sends the sentinel back so the stored key survives", () => {
    const result = validateReadAloudForm(readAloudFormFromSettings(savedSettings));
    expect(result.ok && result.settings.apiKey).toBe(SPEECH_API_KEY_SENTINEL);
  });
});

describe("validation", () => {
  const validForm = readAloudFormFromSettings(savedSettings);

  it.each([
    ["an empty base URL", { baseUrl: "  " }, "baseUrl"],
    ["a malformed base URL", { baseUrl: "not a url" }, "baseUrl"],
    ["a non-http base URL", { baseUrl: "ftp://tts.example.com" }, "baseUrl"],
    ["an empty model", { model: "" }, "model"],
    ["an empty voice", { voice: " " }, "voice"],
    ["a non-numeric limit", { maxCharsPerRequest: "lots" }, "maxCharsPerRequest"],
    ["a fractional limit", { maxCharsPerRequest: "1000.5" }, "maxCharsPerRequest"],
    ["a limit below 200", { maxCharsPerRequest: "199" }, "maxCharsPerRequest"],
    [
      "a limit above the total ceiling",
      { maxCharsPerRequest: String(SPEECH_MAX_TOTAL_CHARS + 1) },
      "maxCharsPerRequest",
    ],
  ] as const)("rejects %s", (_label, override, field) => {
    const result = validateReadAloudForm({ ...validForm, ...override });
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors)).toEqual([field]);
  });

  it("accepts the range boundaries", () => {
    expect(validateReadAloudForm({ ...validForm, maxCharsPerRequest: "200" }).ok).toBe(true);
    expect(
      validateReadAloudForm({ ...validForm, maxCharsPerRequest: String(SPEECH_MAX_TOTAL_CHARS) })
        .ok,
    ).toBe(true);
  });

  it("allows an empty API key for unauthenticated local servers", () => {
    expect(validateReadAloudForm({ ...validForm, apiKey: "" }).ok).toBe(true);
  });
});

describe("dirty tracking", () => {
  it("ignores surrounding whitespace but notices real edits", () => {
    const form = readAloudFormFromSettings(savedSettings);
    expect(isReadAloudFormDirty(form, savedSettings)).toBe(false);
    expect(isReadAloudFormDirty({ ...form, model: " tts-1 " }, savedSettings)).toBe(false);
    expect(isReadAloudFormDirty({ ...form, voice: "alloy" }, savedSettings)).toBe(true);
    expect(isReadAloudFormDirty({ ...form, apiKey: "sk-new" }, savedSettings)).toBe(true);
  });
});
