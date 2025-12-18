import React, { useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, useWindowDimensions, ScrollView } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Cooking">;

export default function CookingModeScreen({ route }: Props) {
  // Keep the screen awake while this screen is mounted
  useKeepAwake();

  const { recipe } = route.params;
  const { width, height } = useWindowDimensions();

  const isTabletLike = Math.min(width, height) >= 768;
  const isLandscape = width >= height;
  const isSplit = isTabletLike && isLandscape && width >= 900;

  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [stepIndex, setStepIndex] = useState(0);

  const stepCount = recipe.steps.length;
  const currentStep = recipe.steps[stepIndex] ?? "";

  const ingredientsOrdered = useMemo(() => {
    return recipe.ingredients
      .map((text, originalIndex) => ({
        text,
        originalIndex,
        isDone: !!checked[originalIndex],
      }))
      .sort((a, b) => Number(a.isDone) - Number(b.isDone));
  }, [recipe.ingredients, checked]);

  function toggleIngredient(originalIndex: number) {
    setChecked((p) => ({ ...p, [originalIndex]: !p[originalIndex] }));
  }

  const IngredientPanel = (
    <View
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: 18,
        padding: 16,
        borderWidth: 1,
        borderColor: "rgba(30,20,10,0.10)",
        flex: 1,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: "#1C1612" }}>Ingredients</Text>
        <Text style={{ opacity: 0.55, color: "#1C1612", fontWeight: "700" }}>
          {Object.values(checked).filter(Boolean).length}/{recipe.ingredients.length}
        </Text>
      </View>

      {recipe.servings ? (
        <Text style={{ marginTop: 4, opacity: 0.6, color: "#1C1612" }}>{recipe.servings}</Text>
      ) : null}

      <FlatList
        data={ingredientsOrdered}
        keyExtractor={(item) => `${item.originalIndex}-${item.text}`}
        style={{ marginTop: 12 }}
        contentContainerStyle={{ paddingBottom: 20 }}
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => toggleIngredient(item.originalIndex)}
            style={({ pressed }) => [
              {
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 12,
                borderBottomWidth: index === ingredientsOrdered.length - 1 ? 0 : 1,
                borderColor: "rgba(30,20,10,0.08)",
              },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={{ width: 30, fontSize: 18, color: "#1C1612" }}>
              {item.isDone ? "☑" : "☐"}
            </Text>
            <Text
              style={{
                flex: 1,
                fontSize: 16,
                color: "#1C1612",
                opacity: item.isDone ? 0.55 : 1,
                textDecorationLine: item.isDone ? "line-through" : "none",
              }}
            >
              {item.text}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );

  const StepsPanel = (
    <View
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: 18,
        padding: 16,
        borderWidth: 1,
        borderColor: "rgba(30,20,10,0.10)",
        flex: 1.35,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: "#1C1612" }}>Steps</Text>
        <Text style={{ opacity: 0.6, color: "#1C1612", fontWeight: "700" }}>
          {stepIndex + 1}/{stepCount}
        </Text>
      </View>

      <View
        style={{
          marginTop: 14,
          backgroundColor: "rgba(28,22,18,0.04)",
          borderRadius: 16,
          padding: 18,
          minHeight: 180,
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            fontSize: isTabletLike ? 22 : 18,
            lineHeight: isTabletLike ? 30 : 26,
            color: "#1C1612",
            fontWeight: "700",
          }}
        >
          {currentStep}
        </Text>
      </View>

      <View style={{ marginTop: 16, flexDirection: "row", gap: 12 }}>
        <Pressable
          onPress={() => setStepIndex((s) => Math.max(0, s - 1))}
          disabled={stepIndex === 0}
          style={{
            flex: 1,
            paddingVertical: 14,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "rgba(30,20,10,0.18)",
            backgroundColor: stepIndex === 0 ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.8)",
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "900", color: "#1C1612", opacity: stepIndex === 0 ? 0.45 : 1 }}>
            Back
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setStepIndex((s) => Math.min(stepCount - 1, s + 1))}
          disabled={stepIndex === stepCount - 1}
          style={{
            flex: 1,
            paddingVertical: 14,
            borderRadius: 16,
            backgroundColor: stepIndex === stepCount - 1 ? "rgba(28,22,18,0.35)" : "#1C1612",
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "900", color: "#FFFFFF", opacity: stepIndex === stepCount - 1 ? 0.6 : 1 }}>
            Next
          </Text>
        </Pressable>
      </View>

      <Text style={{ marginTop: 18, fontWeight: "900", color: "#1C1612" }}>All Steps</Text>
      <ScrollView style={{ marginTop: 8, maxHeight: isTabletLike ? 240 : 180 }}>
        {recipe.steps.map((s, idx) => (
          <Pressable
            key={`${idx}-${s}`}
            onPress={() => setStepIndex(idx)}
            style={({ pressed }) => [
              {
                paddingVertical: 10,
                borderBottomWidth: idx === recipe.steps.length - 1 ? 0 : 1,
                borderColor: "rgba(30,20,10,0.08)",
              },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text
              style={{
                color: "#1C1612",
                opacity: idx === stepIndex ? 1 : 0.7,
                fontWeight: idx === stepIndex ? "900" : "700",
              }}
            >
              {idx + 1}. {s}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#FBF7F2", padding: 24 }}>
      <Text style={{ fontSize: 26, fontWeight: "900", color: "#1C1612" }}>{recipe.title}</Text>

      <View style={{ marginTop: 16, flex: 1, flexDirection: isSplit ? "row" : "column", gap: 16 }}>
        {IngredientPanel}
        {StepsPanel}
      </View>
    </View>
  );
}