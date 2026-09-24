import { useState } from "react";

import { AppTextInput } from "../../../components/AppText";

/** Commits on blur or submit so each keystroke does not fan out a settings write. */
export function AutoResumeMessageField(props: {
  readonly value: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const next = draft;
    setDraft(null);
    if (!props.disabled && next !== null && next !== props.value) props.onCommit(next);
  };
  return (
    <AppTextInput
      className="min-h-10 w-40 rounded-xl px-3 py-2 text-base"
      returnKeyType="done"
      autoCapitalize="none"
      value={draft ?? props.value}
      placeholder={props.placeholder}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      accessibilityLabel="Resume message"
      editable={!props.disabled}
    />
  );
}
