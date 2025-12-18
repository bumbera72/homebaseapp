import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RecipeItem, RootStackParamList } from "../../App";
import { theme } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Recipes">;

const STORAGE_KEYS = {
  recipes: "homebase:recipes:v3",
};

type Filter = "saved" | "links";

export default function RecipesScreen({ route, navigation }: Props) {
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [filter, setFilter] = useState<Filter>(route.params.defaultFilter ?? "saved");
  const selectedId = route.params.selectedId ?? null;

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.recipes);
        if (raw) setRecipes(JSON.parse(raw));
      } catch {
        // ignore
      }
    })();
  }, []);

  async function persist(next: RecipeItem[]) {
    setRecipes(next);
    await AsyncStorage.setItem(STORAGE_KEYS.recipes, JSON.stringify(next));
  }

  async function removeRecipe(id: string) {
    await persist(recipes.filter((r) => r.id !== id));
  }

  async function toggleFavorite(id: string) {
    const next = recipes.map((r) => (r.id === id ? { ...r, favorite: !r.favorite } : r));
    await persist(next);
  }

  const filtered = useMemo(() => {
    const list = recipes.filter((r) => (filter === "saved" ? r.kind === "structured" : r.kind === "link"));
    return [...list].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
  }, [recipes, filter]);

  const empty = filtered.length === 0;

  function Tab({ value, label }: { value: Filter; label: string }) {
    const active = filter === value;
    return (
      <Pressable
        onPress={() => setFilter(value)}
        style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}
      >
        <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.h1}>Recipes</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={({ pressed }) => [styles.softLinkBtn, pressed && styles.pressed]}
        >
          <Text style={styles.softLinkText}>Done</Text>
        </Pressable>
      </View>

      <View style={styles.tabsRow}>
        <Tab value="saved" label="Saved" />
        <Tab value="links" label="Links" />
      </View>

      {empty ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {filter === "saved" ? "No saved recipes yet." : "No links yet."}
          </Text>
          <Text style={styles.body}>
            {filter === "saved"
              ? "You can build your saved library over time. For now, links work great."
              : "Go back to Home → Tonight → Paste a recipe link."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => {
            const isSelected = item.id === selectedId;

            const meta =
              item.kind === "link"
                ? "Recipe link"
                : `${item.ingredients.length} ingredients • ${item.steps.length} steps`;

            return (
              <View style={[styles.card, isSelected && styles.cardSelected]}>
                <View style={styles.titleRow}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {item.title}
                  </Text>

                  <Pressable onPress={() => toggleFavorite(item.id)} hitSlop={10} style={({ pressed }) => pressed && styles.pressed}>
                    <Text style={styles.star}>{item.favorite ? "★" : "☆"}</Text>
                  </Pressable>
                </View>

                <Text style={styles.meta}>{meta}</Text>

                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={() => {
                      route.params.onSelect(item);
                      navigation.goBack();
                    }}
                    style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.primaryBtnText}>Choose for Tonight</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      if (item.kind === "link") navigation.navigate("RecipeLink", { recipe: item });
                      else navigation.navigate("Cooking", { recipe: item });
                    }}
                    style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryBtnText}>Open</Text>
                  </Pressable>

                  <Pressable onPress={() => removeRecipe(item.id)} style={({ pressed }) => [styles.dangerBtn, pressed && styles.pressed]}>
                    <Text style={styles.dangerBtnText}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg, padding: 24 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 },
  h1: { fontSize: 22, color: theme.colors.ink, ...theme.type.h1 },

  softLinkBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.softFill,
  },
  softLinkText: { fontSize: 13, color: theme.colors.ink2, ...theme.type.ui },

  tabsRow: { flexDirection: "row", gap: 10, marginBottom: 12 },

  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.softFill,
    alignItems: "center",
  },
  tabActive: {
    borderColor: "rgba(191,211,193,0.75)",
    backgroundColor: "rgba(191,211,193,0.22)", // sage tint
  },
  tabText: { color: theme.colors.ink2, ...theme.type.ui, opacity: 0.75 },
  tabTextActive: { opacity: 1 },

  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },
  cardSelected: {
    borderColor: "rgba(28,22,18,0.24)",
    backgroundColor: "rgba(255,255,255,0.9)",
  },

  cardTitle: { fontSize: 16, color: theme.colors.ink, ...theme.type.bold },
  body: { marginTop: 6, color: theme.colors.ink3, ...theme.type.body },

  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  itemTitle: { flex: 1, paddingRight: 10, fontSize: 16, color: theme.colors.ink, ...theme.type.bold },

  star: { fontSize: 18, color: theme.colors.ink2 },

  meta: { marginTop: 8, color: theme.colors.ink3, ...theme.type.body },

  actionsRow: { flexDirection: "row", gap: 10, marginTop: 14 },

  primaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: theme.colors.primaryFill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  primaryBtnText: { color: theme.colors.primaryText, ...theme.type.bold },

  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.softFill,
    alignItems: "center",
  },
  secondaryBtnText: { color: theme.colors.ink2, ...theme.type.bold },

  dangerBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(232,201,211,0.55)", // blush border
    backgroundColor: "rgba(232,201,211,0.22)", // blush fill
    alignItems: "center",
  },
  dangerBtnText: { color: theme.colors.ink, ...theme.type.bold, opacity: 0.75 },

  pressed: { opacity: 0.75 },
});