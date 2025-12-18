import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function SoftEmpty({
  title,
  body,
  titleFontFamily,
  bodyFontFamily,
}: {
  title: string;
  body: string;
  titleFontFamily: string;
  bodyFontFamily: string;
}) {
  return (
    <View style={styles.box}>
      <Text style={[styles.title, { fontFamily: titleFontFamily }]}>{title}</Text>
      <Text style={[styles.body, { fontFamily: bodyFontFamily }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.10)",
    backgroundColor: "rgba(28,22,18,0.03)",
  },
  title: { color: "rgba(28,22,18,0.78)" },
  body: { marginTop: 6, color: "rgba(28,22,18,0.55)", lineHeight: 20 },
});