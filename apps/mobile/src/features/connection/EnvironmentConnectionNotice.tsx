import { type EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { useNavigation } from "@react-navigation/native";
import { SymbolView } from "../../components/AppSymbol";
import { ActivityIndicator, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { environmentConnectionNoticeContent } from "./environmentConnectionNoticeContent";

export function EnvironmentConnectionNotice(props: {
  readonly environmentLabel: string;
  readonly connection: EnvironmentConnectionPresentation;
  readonly resourceName: string;
  readonly onRetry: () => void;
}) {
  const navigation = useNavigation();
  const content = environmentConnectionNoticeContent(props);
  const isRetrying =
    props.connection.phase === "connecting" || props.connection.phase === "reconnecting";

  return (
    <View className="flex-1 items-center justify-center px-8">
      <View className="max-w-[320px] items-center gap-3">
        {isRetrying ? (
          <ActivityIndicator size="small" colorClassName={"accent-icon-muted"} />
        ) : (
          <SymbolView
            name={props.connection.phase === "offline" ? "wifi.slash" : "bolt.horizontal.circle"}
            size={24}
            tintColorClassName={"accent-icon-muted"}
            type="monochrome"
          />
        )}

        <Text className="text-center text-lg font-t3-bold text-foreground">{content.title}</Text>
        <Text className="text-center text-sm leading-normal text-foreground-muted">
          {content.detail}
          {props.connection.traceId ? (
            <>
              {" Trace ID: "}
              <Text
                accessibilityHint="Copies the trace ID"
                accessibilityRole="button"
                className="underline decoration-dotted"
                onPress={() =>
                  copyTextWithHaptic(props.connection.traceId!, {
                    target: "connection-trace-id",
                  })
                }
              >
                {props.connection.traceId}
              </Text>
            </>
          ) : null}
        </Text>

        {content.action !== null ? (
          <Pressable
            accessibilityRole="button"
            className="mt-1 rounded-full bg-subtle px-4 py-2.5 active:opacity-70"
            onPress={
              content.action.kind === "pairAgain"
                ? () => navigation.navigate("ConnectionsNew")
                : props.onRetry
            }
          >
            <Text className="text-sm font-t3-bold text-foreground">{content.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
