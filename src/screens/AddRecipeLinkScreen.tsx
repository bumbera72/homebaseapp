import React, { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, Alert, StyleSheet } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LinkRecipe, RootStackParamList } from "../../App";
import { theme } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "AddRecipeLink">;

function isValidUrl(url: string) {
  const u = url.trim();
  return u.startsWith("http://") || u.startsWith("https://");
}

function hostLabel(url: string) {
  try {
    const u = new URL(url.trim());
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "Recipe link";
  }
}

export default function AddRecipeLinkScreen({ route, navigation }: Props) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");

  const canSave = useMemo(() => isValidUrl(url), [url]);

  function save() {
    if (!canSave) {
      Alert.alert("Almost!", "Paste a valid link (must start with https://).");
      return;
    }

    const finalTitle = title.trim().length ? title.trim() : hostLabel(url);

    const recipe: LinkRecipe = {
      kind: "link",
      id: `link-${Date.now()}`,
      title: finalTitle,
      url: url.trim(),
      favorite: false,
    };

    route.params.onCreate(recipe);
    navigation.goBack();
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>
          Paste a recipe link
        </Text>
        <Text style={styles.sub}>
          Pinterest / TikTok / blogs — whatever you already use.
        </Text>

        <Text style={styles.label}>
          Title (optional)
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Auto-fills if blank"
          placeholderTextColor={theme.colors.ink3}
          style={styles.input}
        />

        <Text style={styles.label}>
          Link
        </Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://…"
          placeholderTextColor={theme.colors.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        <Pressable
          onPress={save}
          style={({ pressed }) => [
            styles.primaryBtn,
            !canSave && styles.primaryBtnDisabled,
            pressed && canSave && { opacity: 0.8 },
          ]}
        >
          <Text style={styles.primaryBtnText}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    padding: 24,
  },

  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },

  title: {
    fontSize: 17,
    color: theme.colors.ink,
    ...theme.type.h2,
  },

  sub: {
    marginTop: 6,
    fontSize: 13,
    color: theme.colors.ink3,
    ...theme.type.body,
  },

  label: {
    marginTop: 16,
    fontSize: 13,
    color: theme.colors.ink2,
    ...theme.type.bold,
  },

  input: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.softFill,
    color: theme.colors.ink,
    fontSize: 16,
    ...theme.type.body,
  },

  primaryBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.primaryFill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },

  primaryBtnDisabled: {
    opacity: 0.5,
  },

  primaryBtnText: {
    color: theme.colors.primaryText,
    ...theme.type.bold,
  },
});