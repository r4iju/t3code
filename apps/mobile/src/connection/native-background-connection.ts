import { requireOptionalNativeModule } from "expo";

import { MOBILE_BACKGROUND_RECONNECT_AFTER_MS } from "./app-state-wakeups";

interface NativeBackgroundConnection {
  setEnabled(enabled: boolean, durationMs: number): Promise<void>;
}

const native = requireOptionalNativeModule<NativeBackgroundConnection>("T3BackgroundConnection");

export const supportsBackgroundConnection = native !== null;

export async function setBackgroundConnectionEnabled(enabled: boolean): Promise<void> {
  await native?.setEnabled(enabled, MOBILE_BACKGROUND_RECONNECT_AFTER_MS);
}
