import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, TextInput, Platform } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList, DraftTask, Task } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Later">;

const STORAGE_KEYS = {
  later: "homebase:laterTasks:v1",
  onDeck: "homebase:onDeckTasks:v2",
};

function todayKeyLocal(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatDueLabel(key?: string) {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function isOverdue(key?: string) {
  if (!key) return false;
  return key < todayKeyLocal();
}
function normalizeOnDeckIds(tasks: Task[]): Task[] {
  return tasks.map((t, idx) => ({ ...t, id: idx + 1 }));
}
function normTitle(s: string) {
  return s.trim().toLowerCase();
}

export default function LaterScreen({ navigation }: Props) {
  const [later, setLater] = useState<DraftTask[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // edit title
  const [editTitle, setEditTitle] = useState<string>("");

  // date picker
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(new Date());
  const [activePickerId, setActivePickerId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.later);
        setLater(raw ? (JSON.parse(raw) as DraftTask[]) : []);
      } catch {
        setLater([]);
      }
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.later, JSON.stringify(later)).catch(() => {});
  }, [later]);

  const sortedLater = useMemo(() => {
    const copy = [...later];
    copy.sort((a, b) => {
      const aKey = a.dueDateKey ?? "9999-99-99";
      const bKey = b.dueDateKey ?? "9999-99-99";
      if (aKey === bKey) return (a.title ?? "").localeCompare(b.title ?? "");
      return aKey < bKey ? -1 : 1;
    });
    return copy;
  }, [later]);

  function toggleExpanded(id: string) {
    Haptics.selectionAsync().catch(() => {});
    setExpandedId((prev) => (prev === id ? null : id));
    const item = later.find((x) => x.id === id);
    setEditTitle(item?.title ?? "");
  }

  function updateItem(id: string, patch: Partial<DraftTask>) {
    setLater((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function deleteItem(id: string) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setLater((prev) => prev.filter((t) => t.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  async function moveToOnDeck(id: string, plan: "today" | "upnext") {
    const item = later.find((t) => t.id === id);
    if (!item) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    // load existing On Deck
    let existing: Task[] = [];
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.onDeck);
      existing = raw ? (JSON.parse(raw) as Task[]) : [];
    } catch {
      existing = [];
    }

    const titleSet = new Set(existing.map((t) => normTitle(t.title)));
    const add: Task[] = titleSet.has(normTitle(item.title))
      ? []
      : [
          {
            id: 999999,
            title: item.title,
            done: false,
            category: item.category,
            dueDateKey: item.dueDateKey,
            plan,
          } as Task,
        ];

    const nextOnDeck = normalizeOnDeckIds([...add, ...existing]);
    await AsyncStorage.setItem(STORAGE_KEYS.onDeck, JSON.stringify(nextOnDeck));

    // remove from Later (Later move: A)
    setLater((prev) => prev.filter((t) => t.id !== id));
    setExpandedId(null);
  }

  function openPicker(id: string) {
    setActivePickerId(id);
    setPickerDate(new Date());
    setPickerVisible(true);
  }

  function onPickerChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === "android") setPickerVisible(false);
    if (event.type !== "set") return;

    const dt = selected ?? pickerDate;
    setPickerDate(dt);

    if (activePickerId) {
      updateItem(activePickerId, { dueDateKey: todayKeyLocal(dt) });
    }
  }

  function closeIOSPicker() {
    setPickerVisible(false);
    setActivePickerId(null);
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.h1}>Later</Text>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.7 }}>
            <Text style={styles.headerLink}>Back</Text>
          </Pressable>
        </View>

        <Text style={styles.sub}>Your backlog. Tap an item to edit, schedule, move, or delete.</Text>

        {sortedLater.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>Nothing in Later.</Text>
            <Text style={styles.emptyBody}>Brain dump something and send it here when it’s not for today.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {sortedLater.map((t, idx) => {
              const open = expandedId === t.id;
              const due = t.dueDateKey ? formatDueLabel(t.dueDateKey) : "";
              const overdue = isOverdue(t.dueDateKey);

              return (
                <View key={t.id} style={[styles.rowWrap, idx > 0 && styles.rowDivider]}>
                  <Pressable onPress={() => toggleExpanded(t.id)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.titleLine}>
                        <Text style={styles.title} numberOfLines={1}>
                          {t.title}
                        </Text>
                        {t.dueDateKey ? (
                          <View style={[styles.duePill, overdue && styles.duePillOverdue]}>
                            <Text style={[styles.duePillText, overdue && styles.duePillTextOverdue]}>
                              {overdue ? `Due ${due}` : due}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={styles.meta}>{t.category ? String(t.category) : "General"}</Text>
                    </View>

                    <Text style={styles.chev}>{open ? "▴" : "▾"}</Text>
                  </Pressable>

                  {open ? (
                    <View style={styles.expanded}>
                      <Text style={styles.label}>Edit</Text>
                      <TextInput
                        value={editTitle}
                        onChangeText={setEditTitle}
                        placeholder="Task title…"
                        placeholderTextColor="rgba(28,22,18,0.35)"
                        style={styles.input}
                      />
                      <View style={styles.inlineBtnRow}>
                        <Pressable
                          onPress={() => {
                            const next = editTitle.trim();
                            if (!next) return;
                            updateItem(t.id, { title: next });
                            Haptics.selectionAsync().catch(() => {});
                          }}
                          style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.75 }]}
                        >
                          <Text style={styles.smallBtnText}>Save title</Text>
                        </Pressable>

                        <Pressable
                          onPress={() => {
                            setEditTitle(t.title);
                            Haptics.selectionAsync().catch(() => {});
                          }}
                          style={({ pressed }) => [styles.smallBtnGhost, pressed && { opacity: 0.75 }]}
                        >
                          <Text style={styles.smallBtnGhostText}>Reset</Text>
                        </Pressable>
                      </View>

                      <Text style={[styles.label, { marginTop: 10 }]}>Due date (optional)</Text>
                      <View style={styles.inlineBtnRow}>
                        <Pressable onPress={() => updateItem(t.id, { dueDateKey: todayKeyLocal() })} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}>
                          <Text style={styles.chipText}>Today</Text>
                        </Pressable>
                        <Pressable onPress={() => updateItem(t.id, { dueDateKey: todayKeyLocal(new Date(Date.now() + 86400000)) })} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}>
                          <Text style={styles.chipText}>Tomorrow</Text>
                        </Pressable>
                        <Pressable onPress={() => openPicker(t.id)} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}>
                          <Text style={styles.chipText}>Pick…</Text>
                        </Pressable>
                        <Pressable onPress={() => updateItem(t.id, { dueDateKey: undefined })} style={({ pressed }) => [styles.chipFaint, pressed && { opacity: 0.75 }]}>
                          <Text style={styles.chipTextFaint}>No date</Text>
                        </Pressable>
                      </View>

                      <Text style={[styles.label, { marginTop: 10 }]}>Move to</Text>
                      <View style={styles.moveRow}>
                        <Pressable onPress={() => moveToOnDeck(t.id, "today")} style={({ pressed }) => [styles.moveBtn, pressed && { opacity: 0.75 }]}>
                          <Text style={styles.moveBtnText}>Today Focus</Text>
                        </Pressable>
                        <Pressable onPress={() => moveToOnDeck(t.id, "upnext")} style={({ pressed }) => [styles.moveBtn, pressed && { opacity: 0.75 }]}>
                          <Text style={styles.moveBtnText}>Up Next</Text>
                        </Pressable>
                      </View>

                      <Pressable onPress={() => deleteItem(t.id)} style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.75 }]}>
                        <Text style={styles.deleteText}>Delete</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {pickerVisible ? (
        <View style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>Pick a due date</Text>
          <Text style={styles.pickerSub}>Only set this if it actually matters.</Text>

          <View style={{ marginTop: 10 }}>
            <DateTimePicker
              value={pickerDate}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={onPickerChange}
            />
          </View>

          {Platform.OS === "ios" ? (
            <Pressable onPress={closeIOSPicker} style={({ pressed }) => [styles.pickerDoneBtn, pressed && { opacity: 0.85 }]}>
              <Text style={styles.pickerDoneText}>Done</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FBF7F2" },
  container: { padding: 24, paddingBottom: 80 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  h1: { fontSize: 22, fontWeight: "900", color: "#1C1612" },
  headerLink: { fontSize: 13, fontWeight: "900", color: "#1C1612", opacity: 0.55 },
  sub: { marginTop: 6, opacity: 0.65, color: "#1C1612" },

  emptyBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.10)",
    backgroundColor: "rgba(28,22,18,0.03)",
  },
  emptyTitle: { fontWeight: "900", color: "rgba(28,22,18,0.75)" },
  emptyBody: { marginTop: 4, color: "rgba(28,22,18,0.55)" },

  card: {
    marginTop: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.10)",
    overflow: "hidden",
  },

  rowWrap: {},
  rowDivider: { borderTopWidth: 1, borderTopColor: "rgba(30,20,10,0.08)" },

  row: { flexDirection: "row", alignItems: "center", padding: 14 },
  titleLine: { flexDirection: "row", alignItems: "center" },
  title: { flex: 1, fontSize: 16, fontWeight: "900", color: "#1C1612" },
  meta: { marginTop: 2, fontWeight: "800", color: "#1C1612", opacity: 0.45 },
  chev: { marginLeft: 10, fontSize: 16, opacity: 0.35 },

  duePill: {
    marginLeft: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.10)",
    backgroundColor: "rgba(28,22,18,0.03)",
  },
  duePillOverdue: {
    borderColor: "rgba(28,22,18,0.20)",
    backgroundColor: "rgba(28,22,18,0.06)",
  },
  duePillText: { fontSize: 12, fontWeight: "900", color: "#1C1612", opacity: 0.55 },
  duePillTextOverdue: { opacity: 0.75 },

  expanded: { padding: 14, paddingTop: 0 },
  label: { marginTop: 8, fontWeight: "900", color: "#1C1612", opacity: 0.55 },
  input: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    backgroundColor: "rgba(255,255,255,0.75)",
    padding: 12,
    color: "#1C1612",
    fontSize: 16,
  },

  inlineBtnRow: { marginTop: 10, flexDirection: "row", gap: 10 },
  smallBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, backgroundColor: "#1C1612", alignItems: "center" },
  smallBtnText: { color: "#FFFFFF", fontWeight: "900" },
  smallBtnGhost: {
    width: 88,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    backgroundColor: "rgba(28,22,18,0.03)",
    alignItems: "center",
  },
  smallBtnGhostText: { color: "#1C1612", fontWeight: "900", opacity: 0.75 },

  chip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    backgroundColor: "rgba(255,255,255,0.55)",
    marginRight: 10,
    marginBottom: 10,
  },
  chipText: { fontWeight: "900", color: "#1C1612", opacity: 0.8 },
  chipFaint: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    backgroundColor: "rgba(28,22,18,0.02)",
    marginRight: 10,
    marginBottom: 10,
  },
  chipTextFaint: { fontWeight: "900", color: "#1C1612", opacity: 0.55 },

  moveRow: { marginTop: 10, flexDirection: "row", gap: 10 },
  moveBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, backgroundColor: "#1C1612", alignItems: "center" },
  moveBtnText: { color: "#FFFFFF", fontWeight: "900" },

  deleteBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    backgroundColor: "rgba(28,22,18,0.03)",
    alignItems: "center",
  },
  deleteText: { fontWeight: "900", color: "#1C1612", opacity: 0.65 },

  pickerSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.10)",
    padding: 14,
  },
  pickerTitle: { fontWeight: "900", color: "#1C1612" },
  pickerSub: { marginTop: 4, opacity: 0.6, color: "#1C1612" },
  pickerDoneBtn: { marginTop: 10, paddingVertical: 12, borderRadius: 16, backgroundColor: "#1C1612", alignItems: "center" },
  pickerDoneText: { color: "#FFFFFF", fontWeight: "900" },
});