import React from "react";
import { View, Text } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { WebView } from "react-native-webview";

type Props = NativeStackScreenProps<RootStackParamList, "RecipeLink">;

export default function RecipeLinkScreen({ route }: Props) {
  // Keep the screen awake while this screen is mounted
  useKeepAwake();

  const { recipe } = route.params;

  return (
    <View style={{ flex: 1, backgroundColor: "#FBF7F2" }}>
      <View style={{ padding: 16, paddingBottom: 10 }}>
        <Text style={{ fontSize: 18, fontWeight: "900", color: "#1C1612" }}>
          {recipe.title}
        </Text>
        <Text style={{ marginTop: 4, opacity: 0.6, color: "#1C1612" }} numberOfLines={1}>
          {recipe.url}
        </Text>
      </View>

      <View
        style={{
          flex: 1,
          marginHorizontal: 12,
          marginBottom: 12,
          borderRadius: 18,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "rgba(30,20,10,0.10)",
          backgroundColor: "#FFFFFF",
        }}
      >
        <WebView source={{ uri: recipe.url }} />
      </View>
    </View>
  );
}