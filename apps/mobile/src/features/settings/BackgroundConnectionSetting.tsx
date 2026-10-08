import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Platform, View } from "react-native";

import { supportsBackgroundConnection } from "../../connection/native-background-connection";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

const backgroundConnectionDescription = Platform.select({
  android:
    "Keep connections active for up to 3 minutes after leaving the app. Uses more battery and shows an ongoing notification when allowed.",
  ios: "Keep connections active for up to 3 minutes after leaving the app. Uses more battery. Your device may end background activity earlier.",
  default: "Keep connections active for up to 3 minutes after leaving the app. Uses more battery.",
});

export function BackgroundConnectionSetting() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);

  return (
    <View className="mt-5">
      <SettingsSection title="Connection behavior">
        <SettingsSwitchRow
          icon="desktopcomputer"
          label="Keep connected in background"
          subtitle={
            supportsBackgroundConnection
              ? backgroundConnectionDescription
              : "Install a newer app build to enable background connections."
          }
          value={
            AsyncResult.isSuccess(preferences) &&
            preferences.value.keepConnectedInBackground === true
          }
          disabled={!supportsBackgroundConnection || !AsyncResult.isSuccess(preferences)}
          onValueChange={(keepConnectedInBackground) => {
            void savePreferences({ keepConnectedInBackground });
          }}
        />
      </SettingsSection>
    </View>
  );
}
