import { useFocusEffect } from "@react-navigation/native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";

import { readAloud } from "./readAloud";

/**
 * Mounted by the thread screen: playback belongs to the visible thread, so it
 * stops when that thread changes, when the screen loses focus, and when the app
 * is backgrounded (the audio session is foreground-only).
 */
export function useReadAloudLifecycle(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): void {
  const { environmentId, threadId } = input;

  useEffect(() => {
    const prefix = `${environmentId}:${threadId}:`;
    readAloud.stopUnless((targetKey) => targetKey.startsWith(prefix));
  }, [environmentId, threadId]);

  useFocusEffect(
    useCallback(
      () => () => {
        readAloud.stop();
      },
      [],
    ),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      // iOS reports `inactive` for transient overlays; only real backgrounding stops audio.
      if (nextState === "background") readAloud.stop();
    });
    return () => subscription.remove();
  }, []);
}
