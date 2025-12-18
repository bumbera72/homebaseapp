import React, { useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, Platform, StyleSheet } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { RootStackParamList, DraftTask, Task } from "../../App";
import { theme } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Review">;

const STORAGE_KEYS = {
  onDeck: "homebase:onDeckTasks:v2",
};

function todayKeyLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDaysKey(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayKeyLocal(d);
}
function dateKeyFromDate(dt: Date) {
  return todayKeyLocal(dt);
}
function formatDueLabel(key?: string) {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function normalizeOnDeckIds(tasks: Task[]) {
  return tasks.map((t, idx) => ({ ...t, id: idx + 1 }));
}
function normTitle(s: string) {
  return s.trim().toLowerCase();
}
function planForDraft(d: DraftTask, todayKey: string): "today" | "upnext" {
  return d.dueDateKey && d.dueDateKey === todayKey ? "today" : "upnext";
}

export default function ReviewScreen({ route, navigation }: Props) {
  const initialDrafts = route.params.drafts ?? [];

  const [drafts, setDrafts] = useState<DraftTask[]>(initialDrafts.map((d) => ({ ...d, bucket: "Later" })));

  const [activePickerTaskId, setActivePickerTaskId] = useState<string | null>(null);
  const [pickerDate, setPickerDate] = useState<Date>(new Date());
  const [pickerVisible, setPickerVisible] = useState(false);

  const todayKey = useMemo(() => todayKeyLocal(), []);

  function updateDraft(id: string, patch: Partial<DraftTask>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function removeDraft(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }

  function openPickerFor(taskId: string) {
    setActivePickerTaskId(taskId);
    setPickerDate(new Date());
    setPickerVisible(true);
  }

  function onPickerChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === "android") setPickerVisible(false);
    if (event.type !== "set") return;

    const dt = selected ?? pickerDate;
    setPickerDate(dt);

    if (activePickerTaskId) {
      updateDraft(activePickerTaskId, { dueDateKey: dateKeyFromDate(dt) });
    }
  }

  function closeIOSPicker() {
    setPickerVisible(false);
    setActivePickerTaskId(null);
  }

  async function submit() {
    let existingOnDeck: Task[] = [];
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.onDeck);
      existingOnDeck = raw ? (JSON.parse(raw) as Task[]) : [];
    } catch {
      existingOnDeck = [];
    }

    const onDeckTitleSet = new Set(existingOnDeck.map((t) => normTitle(t.title)));

    const toAdd: Task[] = drafts
      .filter((d) => !onDeckTitleSet.has(normTitle(d.title)))
      .map((d) => ({
        id: 999999,
        title: d.title,
        done: false,
        category: d.category === "Someday" ? undefined : d.category,
        dueDateKey: d.dueDateKey,
        plan: planForDraft(d, todayKey),
      }));

    const nextOnDeck = normalizeOnDeckIds([...toAdd, ...existingOnDeck]);
    await AsyncStorage.setItem(STORAGE_KEYS.onDeck, JSON.stringify(nextOnDeck));

    navigation.popToTop();
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.h1}>Quick Review</Text>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={({ pressed }) => [styles.softLinkBtn, pressed && styles.pressed]}>
            <Text style={styles.softLinkText}>Back</Text>
          </Pressable>
        </View>

        <Text style={styles.sub}>
          Pick timing. Due today → Today Focus. Everything else → Coming Up.
        </Text>

        {drafts.map((d) => {
          const dueBadge = d.dueDateKey ? formatDueLabel(d.dueDateKey) : null;
          const showCategory = d.category && d.category !== "Someday";
          const goesTo = planForDraft(d, todayKey) === "today" ? "Today Focus" : "Coming Up";

          return (
            <View key={d.id} style={styles.card}>
              <View style={styles.titleRow}>
                <View style={styles.titleLeft}>
                  <Text style={styles.title} numberOfLines={1}>
                    {d.title}
                  </Text>

                  {/* category floats to the right of the title (subtle) */}
                  {showCategory ? (
                    <View style={styles.categoryPill}>
                      <Text style={styles.categoryText}>{String(d.category)}</Text>
                    </View>
                  ) : null}
                </View>

                <Pressable onPress={() => removeDraft(d.id)} hitSlop={10} style={({ pressed }) => pressed && styles.pressed}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              </View>

              <View style={styles.metaRow}>
                {/* due badge sits left (reserves space visually) */}
                {dueBadge ? (
                  <View style={styles.duePill}>
                    <Text style={styles.duePillText}>{dueBadge}</Text>
                  </View>
                ) : (
                  <View style={[styles.duePill, styles.duePillEmpty]} />
                )}

                <Text style={styles.goesToText}>{goesTo}</Text>
              </View>

              <View style={styles.chipRow}>
                <Chip label="Today" onPress={() => updateDraft(d.id, { dueDateKey: todayKey })} />
                <Chip label="Tomorrow" onPress={() => updateDraft(d.id, { dueDateKey: addDaysKey(1) })} />
                <Chip label="This week" onPress={() => updateDraft(d.id, { dueDateKey: addDaysKey(3) })} />
                <Chip label="Pick date" onPress={() => openPickerFor(d.id)} />
                <Chip label="No date" onPress={() => updateDraft(d.id, { dueDateKey: undefined })} faint />
              </View>
            </View>
          );
        })}

        <Pressable onPress={submit} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
          <Text style={styles.primaryBtnText}>Add to Homebase</Text>
        </Pressable>
      </ScrollView>

      {pickerVisible ? (
        <View style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>Pick a due date</Text>
          <Text style={styles.pickerSub}>Only set this if it actually matters.</Text>

          <View style={{ marginTop: 10 }}>
            <DateTimePicker value={pickerDate} mode="date" display={Platform.OS === "ios" ? "spinner" : "default"} onChange={onPickerChange} />
          </View>

          {Platform.OS === "ios" ? (
            <Pressable onPress={closeIOSPicker} style={({ pressed }) => [styles.pickerDoneBtn, pressed && styles.pressed]}>
              <Text style={styles.pickerDoneText}>Done</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Chip({ label, onPress, faint }: { label: string; onPress: () => void; faint?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, faint ? styles.chipFaint : null, pressed && styles.pressed]}>
      <Text style={[styles.chipText, faint ? styles.chipTextFaint : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  container: { padding: 24, paddingBottom: 40 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
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

  sub: { marginTop: 8, color: theme.colors.ink3, ...theme.type.body },

  card: {
    marginTop: 14,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },

  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titleLeft: { flex: 1, flexDirection: "row", alignItems: "center", marginRight: 10 },

  // task title = Inter (task content)
  title: { flexShrink: 1, fontSize: 16, color: theme.colors.ink, ...theme.type.bold },

  categoryPill: {
    marginLeft: 10,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(191,211,193,0.18)", // sage tint
  },
  categoryText: { fontSize: 12, color: theme.colors.ink2, ...theme.type.bold },

  removeText: { fontSize: 13, color: theme.colors.ink3, ...theme.type.ui },

  metaRow: { marginTop: 10, flexDirection: "row", alignItems: "center" },
  goesToText: { marginLeft: 10, color: theme.colors.ink3, ...theme.type.ui },

  duePill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(191,215,234,0.18)", // mist tint
  },
  duePillEmpty: { opacity: 0 }, // keep alignment without clutter
  duePillText: { fontSize: 12, color: theme.colors.ink2, ...theme.type.bold },

  chipRow: { marginTop: 12, flexDirection: "row", flexWrap: "wrap" },
  chip: {
    marginRight: 10,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.softFill,
  },
  chipFaint: { backgroundColor: "rgba(28,22,18,0.02)" },
  chipText: { color: theme.colors.ink2, ...theme.type.ui },
  chipTextFaint: { opacity: 0.55 },

  primaryBtn: {
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.primaryFill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  primaryBtnText: { color: theme.colors.primaryText, ...theme.type.bold },

  pickerSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    ...theme.shadow,
  },
  pickerTitle: { color: theme.colors.ink, ...theme.type.h2 },
  pickerSub: { marginTop: 4, color: theme.colors.ink3, ...theme.type.body },
  pickerDoneBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.primaryFill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  pickerDoneText: { color: theme.colors.primaryText, ...theme.type.bold },

  pressed: { opacity: 0.75 },
});