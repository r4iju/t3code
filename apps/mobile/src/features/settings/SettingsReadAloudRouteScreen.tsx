import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import {
  DEFAULT_READ_ALOUD_PLAYBACK_RATE,
  formatReadAloudPlaybackRate,
  READ_ALOUD_PLAYBACK_RATES,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "./components/SettingsSection";

/** Device-local read-aloud playback speed; the environment's voice settings live on web. */
export function SettingsReadAloudRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selectedRate = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.readAloudPlaybackRate ?? DEFAULT_READ_ALOUD_PLAYBACK_RATE)
    : null;

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Read Aloud" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title="Playback speed">
          {READ_ALOUD_PLAYBACK_RATES.map((rate, index) => (
            <Pressable
              key={rate}
              accessibilityRole="radio"
              accessibilityState={{
                checked: selectedRate === rate,
                disabled: !preferencesReady,
              }}
              disabled={!preferencesReady}
              onPress={() => savePreferences({ readAloudPlaybackRate: rate })}
              className={
                index === 0
                  ? "flex-row items-center gap-4 p-4"
                  : "flex-row items-center gap-4 border-t border-border-subtle p-4"
              }
            >
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-lg text-foreground">{formatReadAloudPlaybackRate(rate)}</Text>
                {rate === DEFAULT_READ_ALOUD_PLAYBACK_RATE ? (
                  <Text className="text-sm leading-normal text-foreground-muted">Default</Text>
                ) : null}
              </View>
              {selectedRate === rate ? (
                <SymbolView
                  name="checkmark"
                  size={18}
                  tintColorClassName={"accent-icon"}
                  type="monochrome"
                  weight="semibold"
                />
              ) : null}
            </Pressable>
          ))}
        </SettingsSection>
        <Text className="px-4 text-sm leading-normal text-foreground-muted">
          Applies on this device. Audio is sped up without changing the voice's pitch.
        </Text>
      </ScrollView>
    </View>
  );
}
