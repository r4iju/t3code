import {
  MessageId,
  type ModelSelection,
  type OrchestrationMessage,
  type OrchestrationThreadShell,
  type ThreadUsageLimit,
} from "@t3tools/contracts";

/** Reset times are rounded by providers; resuming on the dot can hit the old window. */
const RESUME_GRACE_MS = 60_000;

/** Auto-scheduled resumes allowed in a row: the resume, then one retry. */
const MAX_TRAILING_AUTO_RESUMES = 2;

const AUTO_RESUME_MESSAGE_ID_PREFIX = "auto-resume:";

const DEFAULT_RESUME_TEXT = "go on";

/** Resume messages carry a marked id so the retry cap survives restarts. */
export function autoResumeMessageId(uuid: string): MessageId {
  return MessageId.make(`${AUTO_RESUME_MESSAGE_ID_PREFIX}${uuid}`);
}

export function countTrailingAutoResumes(
  messages: ReadonlyArray<Pick<OrchestrationMessage, "id" | "role">>,
): number {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    if (!message.id.startsWith(AUTO_RESUME_MESSAGE_ID_PREFIX)) break;
    count += 1;
  }
  return count;
}

export function shouldAutoScheduleResume(input: {
  readonly enabled: boolean;
  readonly usageLimit: ThreadUsageLimit;
  readonly trailingAutoResumes: number;
}): boolean {
  return (
    input.enabled &&
    input.usageLimit.resetsAt !== null &&
    !input.usageLimit.resumeScheduled &&
    input.trailingAutoResumes < MAX_TRAILING_AUTO_RESUMES
  );
}

/**
 * What a scheduled resume needs right now, or null when none is scheduled.
 * A turn Claude parked on the limit is still running and must be stopped
 * before the resume message can start a new one.
 */
export function resolveResumeAction(
  thread: Pick<OrchestrationThreadShell, "usageLimit" | "session">,
  now: string,
): "wait" | "interrupt" | "send" | null {
  const usageLimit = thread.usageLimit;
  if (!usageLimit?.resumeScheduled || usageLimit.resetsAt === null) return null;
  if (!(Date.parse(now) >= Date.parse(usageLimit.resetsAt) + RESUME_GRACE_MS)) return "wait";
  switch (thread.session?.status) {
    case "running":
      return "interrupt";
    case "starting":
      return "wait";
    default:
      return "send";
  }
}

export function autoResumeText(configured: string): string {
  return configured.trim() || DEFAULT_RESUME_TEXT;
}

/** Claude and Cursor use `fastMode`; Codex also expresses it as the `fast` service tier. */
export function withoutFastMode(selection: ModelSelection): ModelSelection {
  const isFast = (option: NonNullable<ModelSelection["options"]>[number]) =>
    (option.id === "fastMode" && option.value === true) ||
    (option.id === "serviceTier" && option.value === "fast");
  if (!selection.options?.some(isFast)) return selection;
  return {
    ...selection,
    options: selection.options.flatMap((option) => {
      if (option.id === "fastMode") return [{ ...option, value: false }];
      if (option.id === "serviceTier" && option.value === "fast") return [];
      return [option];
    }),
  };
}
