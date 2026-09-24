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

/** Offers, or shows, the server-side resume of a thread stopped by a usage limit. */
export const UsageLimitResumeBanner = memo(function UsageLimitResumeBanner({
  environmentId,
  threadId,
  usageLimit,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  usageLimit: ThreadUsageLimit | null | undefined;
}) {
  const timestampFormat = useClientSettings(selectTimestampFormat);
  const setAutoResume = useAtomCommand(threadEnvironment.setAutoResume);
  if (!usageLimit?.resetsAt) return null;
  const upcoming = formatUpcomingTimestamp(usageLimit.resetsAt, timestampFormat);
  const resetTime = upcoming.startsWith("tomorrow") ? upcoming : `at ${upcoming}`;
  const scheduled = usageLimit.resumeScheduled;
  return (
    <div className="pointer-events-auto mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3">
      <Alert variant="info" surface="glass">
        <AlarmClockIcon />
        <AlertDescription>
          {scheduled
            ? `Resumes automatically ${resetTime}.`
            : `The usage limit resets ${resetTime}.`}
        </AlertDescription>
        <AlertAction>
          <Button
            variant={scheduled ? "ghost" : "outline"}
            size="xs"
            onClick={() =>
              void setAutoResume({
                environmentId,
                input: { threadId, scheduled: !scheduled },
              })
            }
          >
            {scheduled ? "Cancel" : `Resume ${resetTime}`}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
});
