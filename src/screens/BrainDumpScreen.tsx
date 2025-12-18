import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { sortBrainDump } from "../utils/brainSort";
import { theme } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "BrainDump">;

export default function BrainDumpScreen({ navigation }: Props) {
  const [text, setText] = useState("");
  const canReview = text.trim().length > 0;

  return (
    <View style={styles.screen}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Brain dump</Text>
          <Text style={styles.sub}>
            One per line. Homebase will auto-sort, then you decide Today vs Later.
          </Text>

          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder={"e.g.\nCall dentist\nBuy milk\nReturn Amazon package\nEmail teacher\nDinner: tacos"}
            placeholderTextColor={theme.colors.ink3}
            style={styles.input}
          />

          <Pressable
            disabled={!canReview}
            onPress={() => {
              const drafts = sortBrainDump(text);
              setText("");
              navigation.navigate("Review", { drafts });
            }}
            style={({ pressed }) => [
              styles.primaryBtn,
              !canReview && styles.primaryBtnDisabled,
              pressed && canReview && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.primaryBtnText}>Sort & Review</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  container: { padding: 24 },

  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },

  title: { fontSize: 20, color: theme.colors.ink, ...theme.type.h2 },
  sub: { marginTop: 6, color: theme.colors.ink3, ...theme.type.body },

  input: {
    marginTop: 14,
    minHeight: 220,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.softFill,
    color: theme.colors.ink,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "top",
    ...theme.type.body,
  },

  primaryBtn: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: theme.radius.lg,
    alignItems: "center",
    backgroundColor: theme.colors.primaryFill,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  primaryBtnText: { color: theme.colors.primaryText, ...theme.type.bold },
});