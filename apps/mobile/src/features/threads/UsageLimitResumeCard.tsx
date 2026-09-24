import type { EnvironmentId, ThreadId, ThreadUsageLimit } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { RequestActionButton } from "./RequestActionButton";

const RESET_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

/** Offers, or shows, the server-side resume of a thread stopped by a usage limit. */
export function UsageLimitResumeCard(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly usageLimit: ThreadUsageLimit & { readonly resetsAt: string };
}) {
  const setAutoResume = useAtomCommand(threadEnvironment.setAutoResume, "auto-resume update");
  const resetTime = RESET_TIME_FORMATTER.format(Date.parse(props.usageLimit.resetsAt));
  const scheduled = props.usageLimit.resumeScheduled;
  return (
    <View className="flex-row items-center gap-3 rounded-[20px] border border-border-subtle bg-card-alt p-4">
      <Text className="min-w-0 flex-1 font-sans text-sm leading-normal text-foreground-secondary">
        {scheduled
          ? `Resumes automatically at ${resetTime}.`
          : `The usage limit resets at ${resetTime}.`}
      </Text>
      <RequestActionButton
        label={scheduled ? "Cancel" : `Resume at ${resetTime}`}
        tone={scheduled ? "secondary" : "primary"}
        onPress={() =>
          void setAutoResume({
            environmentId: props.environmentId,
            input: { threadId: props.threadId, scheduled: !scheduled },
          })
        }
      />
    </View>
  );
}
