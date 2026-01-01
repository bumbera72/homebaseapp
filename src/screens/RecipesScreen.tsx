import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, StyleSheet, Modal, TextInput, ScrollView, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RecipeItem, RootStackParamList } from "../../App";
import { theme } from "../ui/theme";
import { useFocusEffect } from "@react-navigation/native";

type Props = NativeStackScreenProps<RootStackParamList, "Recipes">;

const STORAGE_KEYS = {
  recipes: "homebase:recipes:v3",
};

type Filter = "saved" | "links";

function safeJsonParse(input: string): any | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function toArray<T>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : v != null ? ([v] as T[]) : [];
}

function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] || "").trim();
    if (raw) blocks.push(raw);
  }
  return blocks;
}

function findRecipeObject(obj: any): any | null {
  if (!obj) return null;

  // Common shapes: {"@type":"Recipe"}, {"@graph":[...]}, or arrays
  const candidates: any[] = [];

  if (Array.isArray(obj)) candidates.push(...obj);
  else candidates.push(obj);

  for (const c of candidates) {
    if (!c) continue;

    // If graph, scan it
    if (c["@graph"] && Array.isArray(c["@graph"])) {
      for (const g of c["@graph"]) {
        const found = findRecipeObject(g);
        if (found) return found;
      }
    }

    const t = c["@type"];
    if (typeof t === "string" && t.toLowerCase() === "recipe") return c;
    if (Array.isArray(t) && t.map((x) => String(x).toLowerCase()).includes("recipe")) return c;

    // Some sites nest in mainEntity
    if (c.mainEntity) {
      const found = findRecipeObject(c.mainEntity);
      if (found) return found;
    }
  }

  return null;
}

function normalizeInstructions(inst: any): string[] {
  // Can be string, array of strings, or array of HowToStep objects
  if (!inst) return [];
  if (typeof inst === "string") {
    return inst
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const arr = toArray<any>(inst);
  const out: string[] = [];
  for (const item of arr) {
    if (!item) continue;
    if (typeof item === "string") {
      const lines = item
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      out.push(...lines);
    } else if (typeof item === "object") {
      // HowToStep may use text
      const text = item.text || item.name || item.description;
      if (typeof text === "string" && text.trim()) out.push(text.trim());
      // Some sites use item.itemListElement
      if (item.itemListElement) {
        out.push(...normalizeInstructions(item.itemListElement));
      }
    }
  }
  return out.filter(Boolean);
}

async function importRecipeFromUrl(url: string): Promise<{ title: string; ingredients: string[]; steps: string[] } | null> {
  const res = await fetch(url);
  const html = await res.text();

  const blocks = extractJsonLdBlocks(html);
  for (const b of blocks) {
    const parsed = safeJsonParse(b);
    if (!parsed) continue;
    const recipe = findRecipeObject(parsed);
    if (!recipe) continue;

    const title = String(recipe.name || recipe.headline || "Recipe").trim();
    const ingredients = toArray<string>(recipe.recipeIngredient)
      .map((s) => String(s).trim())
      .filter(Boolean);

    const steps = normalizeInstructions(recipe.recipeInstructions);

    if (ingredients.length || steps.length) {
      return { title, ingredients, steps };
    }
  }

  return null;
}

export default function RecipesScreen({ route, navigation }: Props) {
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [filter, setFilter] = useState<Filter>(route.params.defaultFilter ?? "saved");
  const selectedId = route.params.selectedId ?? null;

  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftIngredients, setDraftIngredients] = useState("");
  const [draftSteps, setDraftSteps] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const loadFromStorage = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.recipes);
      if (!raw) {
        setRecipes([]);
        return;
      }
      const parsed = JSON.parse(raw);
      setRecipes(Array.isArray(parsed) ? (parsed as RecipeItem[]) : []);
    } catch {
      setRecipes([]);
    }
  }, []);

  // Load once on mount
  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  // Reload whenever this screen is focused (e.g., after saving a link)
  useFocusEffect(
    useCallback(() => {
      loadFromStorage();
    }, [loadFromStorage])
  );

  async function persist(next: RecipeItem[]) {
    setRecipes(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.recipes, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  function resetImportModal() {
    setImportUrl("");
    setDraftTitle("");
    setDraftIngredients("");
    setDraftSteps("");
    setImporting(false);
    setImportError(null);
  }

  async function handleImport() {
    const url = importUrl.trim();
    if (!url) {
      setImportError("Paste a recipe URL first.");
      return;
    }
    setImportError(null);
    setImporting(true);
    try {
      const data = await importRecipeFromUrl(url);
      if (!data) {
        setImportError("Couldn’t import this recipe. Try a different link or paste ingredients/steps manually.");
        setImporting(false);
        return;
      }
      setDraftTitle(data.title);
      setDraftIngredients(data.ingredients.join("\n"));
      setDraftSteps(data.steps.join("\n"));
    } catch {
      setImportError("Import failed. Check the link and try again.");
    } finally {
      setImporting(false);
    }
  }

  async function handleSaveDraft() {
    const title = (draftTitle || "Recipe").trim();
    const ingredients = draftIngredients
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const steps = draftSteps
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!ingredients.length && !steps.length) {
      setImportError("Add at least one ingredient or step.");
      return;
    }

    // Build a structured recipe item that Cooking mode can use.
    const recipe: RecipeItem = {
      id: `${Date.now()}`,
      kind: "structured" as any,
      title,
      favorite: false,
      ingredients,
      steps,
    } as any;

    await persist([recipe, ...recipes]);

    // Switch to Saved tab so user can immediately choose it.
    setFilter("saved");
    setShowImport(false);
    resetImportModal();
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
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <Pressable
            onPress={() => {
              setShowImport(true);
              setImportError(null);
            }}
            hitSlop={10}
            style={({ pressed }) => [styles.softLinkBtn, pressed && styles.pressed]}
          >
            <Text style={styles.softLinkText}>Import Recipe</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={10}
            style={({ pressed }) => [styles.softLinkBtn, pressed && styles.pressed]}
          >
            <Text style={styles.softLinkText}>Done</Text>
          </Pressable>
        </View>
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

      <Modal visible={showImport} transparent animationType="fade" onRequestClose={() => setShowImport(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Import recipe for Cooking mode</Text>
              <Pressable
                onPress={() => {
                  setShowImport(false);
                  resetImportModal();
                }}
                hitSlop={10}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Text style={styles.modalClose}>Close</Text>
              </Pressable>
            </View>

            <Text style={styles.modalLabel}>Recipe link</Text>
            <TextInput
              value={importUrl}
              onChangeText={setImportUrl}
              placeholder="Paste a recipe URL…"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10, marginHorizontal: 16 }}>
              <Pressable
                onPress={handleImport}
                disabled={importing}
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed, importing && { opacity: 0.6 }]}
              >
                <Text style={styles.primaryBtnText}>{importing ? "Importing…" : "Import"}</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  // Allow manual entry without a link
                  setImportError(null);
                }}
                style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryBtnText}>Enter Manually</Text>
              </Pressable>
            </View>

            <Text style={styles.hintText}>
              Paste a link to auto-fill ingredients & steps (works on many recipe sites). Or enter everything manually.
            </Text>

            {importing ? (
              <View style={{ marginTop: 12, alignItems: "center" }}>
                <ActivityIndicator />
              </View>
            ) : null}

            {importError ? <Text style={styles.errorText}>{importError}</Text> : null}

            <ScrollView style={{ marginTop: 12 }} contentContainerStyle={{ paddingBottom: 12 }}>
              <Text style={styles.modalLabel}>Title</Text>
              <TextInput value={draftTitle} onChangeText={setDraftTitle} placeholder="Recipe title" style={styles.input} />

              <Text style={styles.modalLabel}>Ingredients (one per line)</Text>
              <TextInput
                value={draftIngredients}
                onChangeText={setDraftIngredients}
                placeholder="• 1 lb chicken\n• 1 cup marinara…"
                multiline
                style={[styles.input, { height: 120, textAlignVertical: "top" }]}
              />

              <Text style={styles.modalLabel}>Steps (one per line)</Text>
              <TextInput
                value={draftSteps}
                onChangeText={setDraftSteps}
                placeholder="1) Preheat oven…\n2) Bread chicken…"
                multiline
                style={[styles.input, { height: 140, textAlignVertical: "top" }]}
              />

              <Pressable onPress={handleSaveDraft} style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}>
                <Text style={styles.saveBtnText}>Save to Saved Recipes</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  flex: 1,
  paddingVertical: 12,
  paddingHorizontal: 14,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.softFill,
  alignItems: "center",
},

hintText: {
  marginTop: 10,
  marginHorizontal: 16,
  color: theme.colors.ink3,
  ...theme.type.body,
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

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    padding: 18,
    justifyContent: "center",
  },
  modalCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    maxHeight: "85%",
    ...theme.shadow,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalTitle: { fontSize: 16, color: theme.colors.ink, ...theme.type.bold },
  modalClose: { fontSize: 13, color: theme.colors.ink2, ...theme.type.ui },
  modalLabel: { marginTop: 10, paddingHorizontal: 16, color: theme.colors.ink2, ...theme.type.ui },
  input: {
    marginTop: 6,
    marginHorizontal: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.softFill,
    color: theme.colors.ink,
    ...theme.type.body,
  },
  errorText: {
    marginTop: 10,
    marginHorizontal: 16,
    color: theme.colors.ink,
    ...theme.type.body,
    opacity: 0.85,
  },
  saveBtn: {
    marginTop: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.primaryFill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  saveBtnText: { color: theme.colors.primaryText, ...theme.type.bold },
});