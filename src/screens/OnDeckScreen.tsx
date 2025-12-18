import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import { RootStackParamList, Task, ArchivedTask } from "../../App";
import { theme } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "OnDeck">;

const STORAGE_KEYS = {
  onDeck: "homebase:onDeckTasks:v2",
  archive: "homebase:archive:v1",
};

function todayKeyLocal(d: Date = new Date()): string {
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

type UndoPayload = { task: Task; archivedId: string };

export default function OnDeckScreen({ route, navigation }: Props) {
  const initialTasks = route.params.tasks ?? [];
  const onUpdate = route.params.onUpdate;

  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [completedTodayCount, setCompletedTodayCount] = useState<number>(0);

  const [undoVisible, setUndoVisible] = useState(false);
  const [undoPayload, setUndoPayload] = useState<UndoPayload | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openTasksSorted = useMemo(() => {
    const open = tasks.filter((t) => !t.done);
    const tk = todayKeyLocal();

    // overdue first, then due today, then soonest due date, then no date, then title
    return [...open].sort((a, b) => {
      const ao = a.dueDateKey && a.dueDateKey < tk ? 0 : 1;
      const bo = b.dueDateKey && b.dueDateKey < tk ? 0 : 1;
      if (ao !== bo) return ao - bo;

      const at = a.dueDateKey === tk ? 0 : 1;
      const bt = b.dueDateKey === tk ? 0 : 1;
      if (at !== bt) return at - bt;

      const aKey = a.dueDateKey ?? "9999-99-99";
      const bKey = b.dueDateKey ?? "9999-99-99";
      if (aKey !== bKey) return aKey < bKey ? -1 : 1;

      return (a.title ?? "").localeCompare(b.title ?? "");
    });
  }, [tasks]);

  async function loadArchiveCount() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.archive);
      const list = raw ? (JSON.parse(raw) as ArchivedTask[]) : [];
      const count = list.filter((x) => x.completedDateKey === todayKeyLocal()).length;
      setCompletedTodayCount(count);
    } catch {
      setCompletedTodayCount(0);
    }
  }

  useEffect(() => {
    loadArchiveCount().catch(() => {});
  }, []);

  function showUndo(task: Task, archivedId: string) {
    setUndoPayload({ task, archivedId });
    setUndoVisible(true);

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => {
      setUndoVisible(false);
      setUndoPayload(null);
    }, 6000);
  }

  async function undoLastComplete() {
    if (!undoPayload) return;
    const { task, archivedId } = undoPayload;

    const nextOnDeck = normalizeOnDeckIds([task, ...tasks]);
    setTasks(nextOnDeck);
    onUpdate?.(nextOnDeck);
    await AsyncStorage.setItem(STORAGE_KEYS.onDeck, JSON.stringify(nextOnDeck));

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.archive);
      const list = raw ? (JSON.parse(raw) as ArchivedTask[]) : [];
      const filtered = list.filter((x) => x.id !== archivedId);
      await AsyncStorage.setItem(STORAGE_KEYS.archive, JSON.stringify(filtered));
    } catch {}

    await loadArchiveCount();

    setUndoVisible(false);
    setUndoPayload(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    Haptics.selectionAsync().catch(() => {});
  }

  async function completeTask(taskId: number) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    const next = tasks.filter((t) => t.id !== taskId);
    setTasks(next);
    onUpdate?.(next);
    await AsyncStorage.setItem(STORAGE_KEYS.onDeck, JSON.stringify(next));

    const archivedId = `arch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const archived: ArchivedTask = {
      id: archivedId,
      title: task.title,
      category: task.category,
      completedDateKey: todayKeyLocal(),
    };

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.archive);
      const existing = raw ? (JSON.parse(raw) as ArchivedTask[]) : [];
      await AsyncStorage.setItem(STORAGE_KEYS.archive, JSON.stringify([archived, ...existing]));
    } catch {
      await AsyncStorage.setItem(STORAGE_KEYS.archive, JSON.stringify([archived]));
    }

    await loadArchiveCount();
    showUndo(task, archivedId);
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.h1}>To Take Care Of</Text>

          <View style={styles.headerActions}>
            <Pressable
              onPress={() => navigation.navigate("Archive")}
              hitSlop={10}
              style={({ pressed }) => [styles.softLinkBtn, pressed && styles.pressed]}
            >
              <Text style={styles.softLinkText}>History</Text>
            </Pressable>

            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={10}
              style={({ pressed }) => [styles.softLinkBtn, pressed && styles.pressed]}
            >
              <Text style={styles.softLinkText}>Back</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sub}>Tap to complete. Due items float to the top.</Text>

        <View style={styles.countRow}>
          <Text style={styles.countText}>Completed today: {completedTodayCount}</Text>
          <Text style={styles.countHint}>{completedTodayCount >= 5 ? "Strong day 💪" : "Tiny wins count 💛"}</Text>
        </View>

        <View style={styles.card}>
          {openTasksSorted.length === 0 ? (
            <EmptyLine title="Nothing active right now." subtitle="If it pops into your head, brain dump it." />
          ) : (
            openTasksSorted.map((t, idx) => {
              const due = t.dueDateKey ? formatDueLabel(t.dueDateKey) : "";
              const overdue = isOverdue(t.dueDateKey);

              return (
                <Pressable
                  key={`${t.id}-${t.title}`}
                  onPress={() => completeTask(t.id)}
                  style={({ pressed }) => [
                    styles.row,
                    idx > 0 && styles.rowDivider,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.checkbox}>☐</Text>

                  <View style={styles.rowBody}>
                    <View style={styles.titleLine}>
                      <Text style={styles.title}>{t.title}</Text>

                      {t.dueDateKey ? (
                        <View style={[styles.duePill, overdue && styles.duePillOverdue]}>
                          <Text style={[styles.duePillText, overdue && styles.duePillTextOverdue]}>
                            {overdue ? `Due ${due}` : due}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {/* category as a subtle pill (more cohesive than plain text) */}
                    {t.category ? (
                      <View style={styles.categoryRow}>
                        <View style={styles.categoryPill}>
                          <Text style={styles.categoryText}>{String(t.category)}</Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      {undoVisible && undoPayload ? (
        <View style={styles.snackbarWrap} pointerEvents="box-none">
          <View style={styles.snackbar}>
            <Text style={styles.snackbarText} numberOfLines={2}>
              Completed: {undoPayload.task.title}
            </Text>
            <Pressable onPress={undoLastComplete} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.75 }}>
              <Text style={styles.snackbarUndo}>Undo</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function EmptyLine({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={{ padding: 16 }}>
      <Text style={{ color: theme.colors.ink2, ...theme.type.bold }}>{title}</Text>
      <Text style={{ marginTop: 6, color: theme.colors.ink3, ...theme.type.body }}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  container: { padding: 24, paddingBottom: 80 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  headerActions: { flexDirection: "row", gap: 10 },

  h1: { fontSize: 22, color: theme.colors.ink, ...theme.type.h1 },

  softLinkBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.softFill,
  },
  softLinkText: { fontSize: 13, color: theme.colors.ink2, ...theme.type.ui },

  sub: { marginTop: 8, color: theme.colors.ink3, ...theme.type.body },

  countRow: { marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  countText: { color: theme.colors.ink3, ...theme.type.bold },
  countHint: { color: theme.colors.ink3, ...theme.type.ui },

  card: {
    marginTop: 14,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    ...theme.shadow,
  },

  row: { flexDirection: "row", alignItems: "flex-start", padding: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: theme.colors.hairline },

  checkbox: { width: 28, fontSize: 18, color: theme.colors.ink },

  rowBody: { flex: 1 },

  titleLine: { flexDirection: "row", alignItems: "center" },
  title: { flex: 1, fontSize: 16, color: theme.colors.ink, ...theme.type.bold },

  duePill: {
    marginLeft: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(191,215,234,0.20)", // mist tint
  },
  duePillOverdue: {
    borderColor: "rgba(28,22,18,0.18)",
    backgroundColor: "rgba(232,201,211,0.24)", // blush tint
  },
  duePillText: { fontSize: 12, color: theme.colors.ink2, ...theme.type.bold },
  duePillTextOverdue: { color: theme.colors.ink },

  categoryRow: { marginTop: 8, flexDirection: "row" },
  categoryPill: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(191,211,193,0.18)", // sage tint
  },
  categoryText: { fontSize: 12, color: theme.colors.ink2, ...theme.type.bold },

  snackbarWrap: { position: "absolute", left: 0, right: 0, bottom: 18, alignItems: "center" },
  snackbar: {
    width: "92%",
    maxWidth: 520,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: theme.radius.xl,
    backgroundColor: "rgba(28,22,18,0.92)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  snackbarText: { color: "#FFFFFF", ...theme.type.ui, flex: 1, marginRight: 12 },
  snackbarUndo: { color: "#FFFFFF", ...theme.type.bold, opacity: 0.9 },

  pressed: { opacity: 0.75 },
});