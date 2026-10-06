import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect } from "react";

import { mobilePreferencesAtom } from "../state/preferences";
import { useWorkspaceEnvironments } from "../state/workspace";
import { setBackgroundConnectionEnabled } from "./native-background-connection";

export function BackgroundConnectionCoordinator() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const environments = useWorkspaceEnvironments();
  const enabled =
    AsyncResult.isSuccess(preferences) &&
    preferences.value.keepConnectedInBackground === true &&
    environments.some((environment) => environment.isEnabled);

  // Native lifecycle handlers own the deadline even when JavaScript timers pause.
  useEffect(() => {
    void setBackgroundConnectionEnabled(enabled).catch((error: unknown) => {
      console.warn("Could not configure background connections.", error);
    });
  }, [enabled]);

  // Release native retention when the app registry is torn down.
  useEffect(
    () => () => {
      void setBackgroundConnectionEnabled(false).catch(() => undefined);
    },
    [],
  );

  return null;
}
