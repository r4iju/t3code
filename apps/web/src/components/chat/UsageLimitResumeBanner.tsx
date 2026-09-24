import type { ClientSettings, EnvironmentId, ThreadId, ThreadUsageLimit } from "@t3tools/contracts";
import { AlarmClockIcon } from "lucide-react";
import { memo } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";

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
  const scheduled = usageLimit.resumeScheduled;
  return {
    scheduled,
    resetTime: upcoming.startsWith("tomorrow") ? upcoming : `at ${upcoming}`,
    toggle: () => void setAutoResume({ environmentId, input: { threadId, scheduled: !scheduled } }),
  };
}

/** Schedule or cancel control, folded into the usage-limit error banner. */
export const UsageLimitResumeAction = memo(function UsageLimitResumeAction(
  props: UsageLimitResumeProps,
) {
  const { scheduled, resetTime, toggle } = useUsageLimitResume(props);
  if (!scheduled) {
    return (
      <Button variant="outline" size="xs" onClick={toggle}>
        Resume {resetTime}
      </Button>
    );
  }
  return (
    <>
      <span className="text-xs whitespace-nowrap text-muted-foreground">Resumes {resetTime}</span>
      <Button variant="ghost" size="xs" onClick={toggle}>
        Cancel
      </Button>
    </>
  );
});

/** Stand-in when no error banner is showing, so a scheduled resume stays visible and cancellable. */
export const UsageLimitResumeBanner = memo(function UsageLimitResumeBanner(
  props: UsageLimitResumeProps,
) {
  return (
    <div className="pointer-events-auto mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3">
      <Alert variant="info" surface="glass">
        <AlarmClockIcon />
        <AlertDescription>Usage limit reached.</AlertDescription>
        <AlertAction>
          <UsageLimitResumeAction {...props} />
        </AlertAction>
      </Alert>
    </div>
  );
});
