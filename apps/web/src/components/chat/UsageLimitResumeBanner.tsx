import type { ClientSettings, EnvironmentId, ThreadId, ThreadUsageLimit } from "@t3tools/contracts";
import { AlarmClockIcon } from "lucide-react";
import { memo } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { ThreadErrorBanner } from "./ThreadErrorBanner";

const selectTimestampFormat = (settings: ClientSettings) => settings.timestampFormat;

interface UsageLimitResumeProps {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  usageLimit: ThreadUsageLimit & { resetsAt: string };
}

function useUsageLimitResume({ environmentId, threadId, usageLimit }: UsageLimitResumeProps) {
  const timestampFormat = useClientSettings(selectTimestampFormat);
  const setAutoResume = useAtomCommand(threadEnvironment.setAutoResume);
  const upcoming = formatUpcomingTimestamp(usageLimit.resetsAt, timestampFormat);
  const when = upcoming.startsWith("tomorrow") ? upcoming : `at ${upcoming}`;
  const scheduled = usageLimit.resumeScheduled;
  return {
    status: scheduled ? `Resumes automatically ${when}.` : `Resets ${when}.`,
    action: (
      <Button
        variant={scheduled ? "ghost" : "outline"}
        size="xs"
        onClick={() =>
          void setAutoResume({ environmentId, input: { threadId, scheduled: !scheduled } })
        }
      >
        {scheduled ? "Cancel" : "Auto-resume"}
      </Button>
    ),
  };
}

/** The usage-limit error, with the reset time in place of "send it again" and a resume toggle. */
export const UsageLimitErrorBanner = memo(function UsageLimitErrorBanner({
  error,
  onDismiss,
  ...props
}: UsageLimitResumeProps & { error: string; onDismiss: () => void }) {
  const { status, action } = useUsageLimitResume(props);
  // Keep the provider's "… usage limit reached." and drop its advice to resend.
  const headline = error.match(/^.*?[.!](?=\s|$)/)?.[0] ?? error;
  return (
    <ThreadErrorBanner
      error={error}
      summary={`${headline} ${status}`}
      action={action}
      onDismiss={onDismiss}
    />
  );
});

/** Stand-in when no error banner is showing, so a scheduled resume stays visible and cancellable. */
export const UsageLimitResumeBanner = memo(function UsageLimitResumeBanner(
  props: UsageLimitResumeProps,
) {
  const { status, action } = useUsageLimitResume(props);
  return (
    <div className="pointer-events-auto mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3">
      <Alert variant="info" surface="glass">
        <AlarmClockIcon />
        <AlertDescription>Usage limit reached. {status}</AlertDescription>
        <AlertAction>{action}</AlertAction>
      </Alert>
    </div>
  );
});
