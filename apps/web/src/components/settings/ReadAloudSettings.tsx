import { READ_ALOUD_SAMPLE_KEY } from "@t3tools/client-runtime/read-aloud";
import {
  DEFAULT_READ_ALOUD_PLAYBACK_RATE,
  formatReadAloudPlaybackRate,
  READ_ALOUD_PLAYBACK_RATES,
  SPEECH_DIALECT_LABELS,
  SPEECH_DIALECTS,
  SPEECH_SUMMARY_DEFAULT_BASE_URL,
  type SpeechDialect,
  type SpeechSettings,
} from "@t3tools/contracts";
import { SquareIcon, Volume2Icon } from "lucide-react";
import { useState } from "react";

import {
  useClientSettings,
  usePrimarySettings,
  useUpdateClientSettings,
  useUpdatePrimarySettings,
} from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { readAloud, useReadAloudPhase } from "../../state/readAloud";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import {
  applyReadAloudPreset,
  isReadAloudFormDirty,
  READ_ALOUD_PRESET_LABELS,
  readAloudEnabledPatch,
  readAloudFormFromSettings,
  type ReadAloudFormErrors,
  type ReadAloudFormValues,
  type ReadAloudPreset,
  SPEECH_MIN_CHARS_PER_REQUEST,
  validateReadAloudForm,
} from "./ReadAloudSettings.logic";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const PRESETS: ReadonlyArray<ReadAloudPreset> = ["openai", "local"];

export function ReadAloudSettings() {
  const speech = usePrimarySettings((settings) => settings.speech);
  const updateSettings = useUpdatePrimarySettings();

  return (
    <SettingsSection id="read-aloud" title="Read aloud">
      <SettingsRow
        {...searchableSetting("read-aloud-enabled")}
        serverScoped
        description="Play finished agent responses through a speech service such as OpenAI or a local server."
        control={
          <Switch
            checked={speech !== null}
            aria-label="Enable read aloud"
            onCheckedChange={(checked) => updateSettings(readAloudEnabledPatch(checked))}
          />
        }
      />
      {speech !== null ? (
        <>
          <ReadAloudForm
            // Keyed on the saved block so a save (or another client's write) resets the draft.
            key={JSON.stringify(readAloudFormFromSettings(speech))}
            saved={speech}
            onSave={(settings) => updateSettings({ speech: settings })}
          />
          <ReadAloudSpeedRow />
        </>
      ) : null}
    </SettingsSection>
  );
}

function ReadAloudForm({
  saved,
  onSave,
}: {
  saved: SpeechSettings;
  onSave: (settings: SpeechSettings) => void;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const [form, setForm] = useState<ReadAloudFormValues>(() => readAloudFormFromSettings(saved));
  const [errors, setErrors] = useState<ReadAloudFormErrors>({});
  const samplePhase = useReadAloudPhase(READ_ALOUD_SAMPLE_KEY);

  const dirty = isReadAloudFormDirty(form, saved);
  const update = (patch: Partial<ReadAloudFormValues>) => {
    setForm((current) => ({ ...current, ...patch }));
  };
  const save = () => {
    const result = validateReadAloudForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSave(result.settings);
  };
  const testVoice = () => {
    if (environmentId === null) return;
    readAloud.toggle({ key: READ_ALOUD_SAMPLE_KEY, environmentId, input: { _tag: "sample" } });
  };

  return (
    <>
      <SettingsRow
        {...searchableSetting("read-aloud-base-url")}
        serverScoped
        description="Any endpoint that speaks the OpenAI speech API."
        status={errors.baseUrl}
        control={
          <Input
            size="sm"
            className="sm:w-72"
            aria-label="Base URL"
            placeholder="https://api.openai.com/v1"
            value={form.baseUrl}
            onChange={(event) => update({ baseUrl: event.target.value })}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("read-aloud-api-key")}
        serverScoped
        description="Stored on the server and never sent back to clients. Leave blank for local servers."
        control={
          <Input
            size="sm"
            className="sm:w-72"
            type="password"
            autoComplete="off"
            aria-label="API key"
            value={form.apiKey}
            onChange={(event) => update({ apiKey: event.target.value })}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("read-aloud-model")}
        serverScoped
        status={errors.model}
        control={
          <Input
            size="sm"
            className="sm:w-72"
            aria-label="Model"
            value={form.model}
            onChange={(event) => update({ model: event.target.value })}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("read-aloud-voice")}
        serverScoped
        status={errors.voice}
        control={
          <Input
            size="sm"
            className="sm:w-72"
            aria-label="Voice"
            value={form.voice}
            onChange={(event) => update({ voice: event.target.value })}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("read-aloud-dialect")}
        serverScoped
        description="Kokoro reads inline pause and voice markers, so responses get a beat between bullets. Other endpoints would speak the markers out loud."
        control={
          <Select
            value={form.dialect}
            onValueChange={(value) => update({ dialect: value as SpeechDialect })}
          >
            <SelectTrigger size="sm" className="w-full sm:w-72" aria-label="Speech dialect">
              <SelectValue>{SPEECH_DIALECT_LABELS[form.dialect]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {SPEECH_DIALECTS.map((candidate) => (
                <SelectItem hideIndicator key={candidate} value={candidate}>
                  {SPEECH_DIALECT_LABELS[candidate]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {form.dialect === "kokoro" ? (
        <SettingsRow
          {...searchableSetting("read-aloud-cjk-voice")}
          serverScoped
          description="Japanese, Chinese and Korean go to this voice instead of being spelled out character by character. Anything Han is read as Japanese, so name a Chinese voice if you would rather have that. Leave blank to use the voice above."
          control={
            <Input
              size="sm"
              className="sm:w-72"
              aria-label="CJK voice"
              placeholder="jf_alpha"
              value={form.cjkVoice}
              onChange={(event) => update({ cjkVoice: event.target.value })}
            />
          }
        />
      ) : null}
      <SettingsRow
        {...searchableSetting("read-aloud-summary-url")}
        serverScoped
        description="A chat model that turns a table into a sentence or two instead of reading every cell. Any OpenAI-shaped endpoint, meant for a local one. Leave blank to read tables out."
        status={errors.summaryBaseUrl}
        control={
          <Input
            size="sm"
            className="sm:w-72"
            aria-label="Table summary URL"
            placeholder={SPEECH_SUMMARY_DEFAULT_BASE_URL}
            value={form.summaryBaseUrl}
            onChange={(event) => update({ summaryBaseUrl: event.target.value })}
          />
        }
      />
      {form.summaryBaseUrl.trim().length > 0 ? (
        <SettingsRow
          {...searchableSetting("read-aloud-summary-model")}
          serverScoped
          status={errors.summaryModel}
          control={
            <Input
              size="sm"
              className="sm:w-72"
              aria-label="Table summary model"
              value={form.summaryModel}
              onChange={(event) => update({ summaryModel: event.target.value })}
            />
          }
        />
      ) : null}
      <SettingsRow
        {...searchableSetting("read-aloud-max-chars")}
        serverScoped
        description={`Long responses are split into requests no larger than this (${SPEECH_MIN_CHARS_PER_REQUEST} or more).`}
        status={errors.maxCharsPerRequest}
        control={
          <Input
            size="sm"
            className="sm:w-32"
            inputMode="numeric"
            aria-label="Max characters per request"
            value={form.maxCharsPerRequest}
            onChange={(event) => update({ maxCharsPerRequest: event.target.value })}
          />
        }
      />
      <SettingsRow
        title="Presets"
        serverScoped
        description="Prefill the fields above; nothing is saved until you press Save."
        status={dirty ? "Unsaved changes. Test voice uses the saved settings." : undefined}
        control={
          <>
            {PRESETS.map((preset) => (
              <Button
                key={preset}
                size="xs"
                variant="outline"
                onClick={() => {
                  setErrors({});
                  setForm((current) => applyReadAloudPreset(current, preset));
                }}
              >
                {READ_ALOUD_PRESET_LABELS[preset]}
              </Button>
            ))}
            <Button
              size="xs"
              variant="outline"
              disabled={dirty || environmentId === null}
              aria-label={samplePhase === "idle" ? "Test voice" : "Stop test"}
              onClick={testVoice}
            >
              {samplePhase === "loading" ? (
                <Spinner />
              ) : samplePhase === "playing" ? (
                <SquareIcon className="fill-current" />
              ) : (
                <Volume2Icon />
              )}
              {samplePhase === "idle" ? "Test voice" : "Stop"}
            </Button>
            <Button size="xs" disabled={!dirty} onClick={save}>
              Save
            </Button>
          </>
        }
      />
    </>
  );
}

/** Per-device: playback speed lives in client settings, not on the environment. */
function ReadAloudSpeedRow() {
  const rate = useClientSettings((settings) => settings.readAloudPlaybackRate);
  const updateClientSettings = useUpdateClientSettings();

  return (
    <SettingsRow
      {...searchableSetting("read-aloud-speed")}
      description="Applies on this device. Audio is sped up without changing the voice's pitch."
      resetAction={
        rate !== DEFAULT_READ_ALOUD_PLAYBACK_RATE ? (
          <SettingResetButton
            label="read aloud speed"
            onClick={() =>
              void updateClientSettings({ readAloudPlaybackRate: DEFAULT_READ_ALOUD_PLAYBACK_RATE })
            }
          />
        ) : null
      }
      control={
        <Select
          value={String(rate)}
          onValueChange={(value) => {
            const next = READ_ALOUD_PLAYBACK_RATES.find((candidate) => String(candidate) === value);
            if (next !== undefined) void updateClientSettings({ readAloudPlaybackRate: next });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-32" aria-label="Read aloud speed">
            <SelectValue>{formatReadAloudPlaybackRate(rate)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {READ_ALOUD_PLAYBACK_RATES.map((candidate) => (
              <SelectItem hideIndicator key={candidate} value={String(candidate)}>
                {formatReadAloudPlaybackRate(candidate)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
