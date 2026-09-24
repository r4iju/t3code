import type { EnvironmentId, ThreadId, ThreadUsageLimit } from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { RequestActionButton } from "./RequestActionButton";

const RESET_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const RESET_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "numeric",
  day: "numeric",
});

/** Weekly limits reset days out, so anything past today names the day. */
function formatReset(iso: string): string {
  const date = new Date(iso);
  const time = RESET_TIME_FORMATTER.format(date);
  return date.toDateString() === new Date().toDateString()
    ? `at ${time}`
    : `${RESET_DAY_FORMATTER.format(date)} at ${time}`;
}

/** Offers, or shows, the server-side resume of a thread stopped by a usage limit. */
export function UsageLimitResumeCard(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly usageLimit: ThreadUsageLimit & { readonly resetsAt: string };
}) {
  const setAutoResume = useAtomCommand(threadEnvironment.setAutoResume, "auto-resume update");
  const [pending, setPending] = useState(false);
  const resetTime = formatReset(props.usageLimit.resetsAt);
  const scheduled = props.usageLimit.resumeScheduled;
  return (
    <View className="gap-2.5 rounded-[20px] border border-border-subtle bg-card-alt p-4">
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-danger-foreground">
        Usage limit reached
      </Text>
      <Text className="font-sans text-sm leading-normal text-foreground-secondary">
        {scheduled ? `Resumes automatically ${resetTime}.` : `Resets ${resetTime}.`}
      </Text>
      <View className="flex-row">
        <RequestActionButton
          label={scheduled ? "Cancel" : "Auto-resume"}
          tone={scheduled ? "secondary" : "primary"}
          disabled={pending}
          onPress={() => {
            setPending(true);
            void setAutoResume({
              environmentId: props.environmentId,
              input: { threadId: props.threadId, scheduled: !scheduled },
            }).finally(() => setPending(false));
          }}
        />
      </View>
    </View>
  );
}
