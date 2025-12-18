import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { theme } from "../ui/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList, ArchivedTask } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Archive">;

const STORAGE_KEYS = {
  archive: "homebase:archive:v1",
};

function formatDateKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function ArchiveScreen({ navigation }: Props) {
  const [items, setItems] = useState<ArchivedTask[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.archive);
        setItems(raw ? (JSON.parse(raw) as ArchivedTask[]) : []);
      } catch {
        setItems([]);
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ArchivedTask[]>();
    for (const it of items) {
      const k = it.completedDateKey;
      map.set(k, [...(map.get(k) ?? []), it]);
    }
    // newest first
    const keys = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : -1));
    return keys.map((k) => ({ dateKey: k, rows: map.get(k) ?? [] }));
  }, [items]);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.h1}>History</Text>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={10}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.backBtnText}>Done</Text>
          </Pressable>
        </View>

        <Text style={styles.sub}>A simple log of what you finished, by day.</Text>

        {grouped.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>Nothing completed yet.</Text>
            <Text style={styles.emptyBody}>Check something off in On Deck and it’ll show up here.</Text>
          </View>
        ) : (
          grouped.map((g) => (
            <View key={g.dateKey} style={{ marginTop: 16 }}>
              <Text style={styles.dateHeader}>{formatDateKey(g.dateKey)}</Text>

              <View style={styles.card}>
                {g.rows.map((r, idx) => (
                  <View key={r.id} style={[styles.row, idx > 0 && styles.rowDivider]}>
                    <Text style={styles.check}>✓</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.title}>{r.title}</Text>
                      {r.category ? <Text style={styles.meta}>{String(r.category)}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  container: { padding: 24, paddingBottom: 40 },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  h1: { fontSize: 24, color: theme.colors.ink, ...theme.type.h1 },

  backBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.softFill,
  },
  backBtnText: { color: theme.colors.ink, ...theme.type.bold, opacity: 0.9 },

  sub: { marginTop: 6, fontSize: 13, color: theme.colors.ink3, ...theme.type.body },

  dateHeader: { marginTop: 6, fontSize: 13, color: theme.colors.ink2, ...theme.type.ui },

  card: {
    marginTop: 10,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },

  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: theme.colors.hairline },

  check: { width: 22, fontSize: 16, color: theme.colors.ink3, ...theme.type.bold },
  title: { fontSize: 16, color: theme.colors.ink, ...theme.type.bold },
  meta: { marginTop: 2, color: theme.colors.ink3, ...theme.type.ui },

  emptyBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.softFill,
    ...theme.shadow,
  },
  emptyTitle: { color: theme.colors.ink2, ...theme.type.bold },
  emptyBody: { marginTop: 4, color: theme.colors.ink3, ...theme.type.body },
});