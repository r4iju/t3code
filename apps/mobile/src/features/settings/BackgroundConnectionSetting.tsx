import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";

import { supportsBackgroundConnection } from "../../connection/native-background-connection";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

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
              ? "Keep connections active for up to 3 minutes after leaving the app. Uses more battery. Android shows a notification when allowed; iOS may stop earlier."
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
