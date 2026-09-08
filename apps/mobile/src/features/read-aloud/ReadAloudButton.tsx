import { readAloudMessageKey } from "@t3tools/client-runtime/read-aloud";
import type { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { prepareSpeechText } from "@t3tools/shared/speechText";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useMemo } from "react";
import { ActivityIndicator, type ColorValue, Pressable } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { useEnvironmentServerConfig } from "../../state/entities";
import { readAloud, useReadAloudSelector } from "./readAloud";
import {
  resolveReadAloudButtonPhase,
  resolveReadAloudButtonPresentation,
} from "./readAloudPresentation";

/** Renders nothing when the environment has read aloud off or the message has no prose. */
export const ReadAloudButton = memo(function ReadAloudButton(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly tintColor: ColorValue;
  readonly buttonSize?: number;
  readonly iconSize?: number;
}) {
  const { environmentId, threadId, messageId, text } = props;
  const speechEnabled = useEnvironmentServerConfig(environmentId)?.settings.speech != null;
  const speakable = useMemo(() => prepareSpeechText(text).length > 0, [text]);
  const key = readAloudMessageKey({ environmentId, threadId, messageId });
  const phase = useReadAloudSelector(
    useCallback((state) => resolveReadAloudButtonPhase(state, key), [key]),
  );
  const onPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    readAloud.toggle({ key, environmentId, input: { _tag: "message", threadId, messageId } });
  }, [environmentId, key, messageId, threadId]);

  if (!speechEnabled || !speakable) return null;

  const presentation = resolveReadAloudButtonPresentation(phase);
  const size = props.buttonSize ?? 30;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={presentation.accessibilityLabel}
      accessibilityState={{ busy: presentation.busy }}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9,
        opacity: pressed ? 0.52 : 1,
      })}
    >
      {presentation.icon === null ? (
        <ActivityIndicator color={props.tintColor} size="small" />
      ) : (
        <SymbolView
          name={presentation.icon}
          size={props.iconSize ?? 13}
          tintColor={props.tintColor}
          type="monochrome"
        />
      )}
    </Pressable>
  );
});
