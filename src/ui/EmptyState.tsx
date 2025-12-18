import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";

type Props = {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function EmptyState({ title, subtitle, actionLabel, onAction }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>

      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      {actionLabel && onAction ? (
        <Pressable onPress={onAction} style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 18,
    alignItems: "center",
  },
  // Empty state TITLE: keep it calm, but structured (Inter, not Fraunces)
  title: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#1C1612",
    opacity: 0.72,
    textAlign: "center",
  },
  // Empty state SUBTITLE: Inter, quieter
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "#1C1612",
    opacity: 0.48,
    textAlign: "center",
  },
  button: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "rgba(28,22,18,0.06)",
  },
  buttonText: {
    fontFamily: "Inter_700Bold",
    color: "#1C1612",
    opacity: 0.8,
  },
});