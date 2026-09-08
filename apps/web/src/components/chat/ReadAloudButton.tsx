import { readAloudMessageKey } from "@t3tools/client-runtime/read-aloud";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { prepareSpeechText } from "@t3tools/shared/speechText";
import { SquareIcon, Volume2Icon } from "lucide-react";
import { memo, useMemo } from "react";

import { cn } from "~/lib/utils";

import { readAloud, useReadAloudPhase, useSpeechConfigured } from "../../state/readAloud";
import type { ChatMessage } from "../../types";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  READ_ALOUD_BUTTON_LABELS,
  resolveReadAloudButtonVisibility,
} from "./ReadAloudButton.logic";

/** Sits beside the assistant copy button; hidden until the response can be spoken. */
export const AssistantReadAloudButton = memo(function AssistantReadAloudButton({
  message,
  showCopyButton,
  streaming,
  threadRef,
  environmentId,
}: {
  message: ChatMessage;
  showCopyButton: boolean;
  streaming: boolean;
  threadRef: ScopedThreadRef | null;
  environmentId: EnvironmentId;
}) {
  const speechConfigured = useSpeechConfigured(environmentId);
  const text = message.text ?? "";
  const speakable = useMemo(
    () => !streaming && text.length > 0 && prepareSpeechText(text).length > 0,
    [streaming, text],
  );
  const visible = resolveReadAloudButtonVisibility({
    showCopyButton,
    streaming,
    hasThreadRef: threadRef !== null,
    speechConfigured,
    speakable,
  });
  if (!visible || threadRef === null) return null;
  return <ReadAloudToggleButton threadRef={threadRef} messageId={message.id} />;
});

function ReadAloudToggleButton({
  threadRef,
  messageId,
}: {
  threadRef: ScopedThreadRef;
  messageId: ChatMessage["id"];
}) {
  const key = readAloudMessageKey({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    messageId,
  });
  const phase = useReadAloudPhase(key);
  const label = READ_ALOUD_BUTTON_LABELS[phase];

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            type="button"
            size="xs"
            variant="ghost"
            className={cn(
              "text-muted-foreground hover:text-foreground",
              phase !== "idle" && "text-foreground",
            )}
            onClick={() =>
              readAloud.toggle({
                key,
                environmentId: threadRef.environmentId,
                input: { _tag: "message", threadId: threadRef.threadId, messageId },
              })
            }
          />
        }
      >
        {phase === "loading" ? (
          <Spinner className="size-3" />
        ) : phase === "playing" ? (
          <SquareIcon className="size-3 fill-current" />
        ) : (
          <Volume2Icon className="size-3" />
        )}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
}
