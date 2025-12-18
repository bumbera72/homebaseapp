import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Modal,
  TextInput,
  AppState,
  AppStateStatus,
  Linking,
} from "react-native";
import * as Calendar from "expo-calendar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";

type Props = {
  titleFontFamily: string; // "Fraunces_700Bold"
  bodyFontFamily: string; // "Inter_500Medium"
  uiFontFamily: string; // "Inter_600SemiBold" or "Inter_700Bold"
};

type CalEvent = {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  notes?: string;
  location?: string;
  url?: string;
};

const STORAGE_KEYS = {
  selectedCalendarIds: "homebase:cal:selectedCalendarIds:v1",
  writeCalendarId: "homebase:cal:writeCalendarId:v1",
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
function fmtTime(dt: Date) {
  return dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function roundToNext30(d: Date) {
  const dt = new Date(d);
  const minutes = dt.getMinutes();
  const add = minutes === 0 || minutes === 30 ? 0 : minutes < 30 ? 30 - minutes : 60 - minutes;
  dt.setMinutes(minutes + add);
  dt.setSeconds(0);
  dt.setMilliseconds(0);
  return dt;
}
function minutesBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}
function fmtDateLine(dt: Date) {
  return dt.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export default function TodayScheduleCard({ titleFontFamily, bodyFontFamily, uiFontFamily }: Props) {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [writeCalId, setWriteCalId] = useState<string | null>(null);
  const [writeCalName, setWriteCalName] = useState<string>("");

  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);

  // Add event modal state
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newStart, setNewStart] = useState<Date>(() => roundToNext30(new Date()));
  const [durationMin, setDurationMin] = useState<number>(60);
  const [pickerVisible, setPickerVisible] = useState(false);

  // Event details modal state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeEvent, setActiveEvent] = useState<CalEvent | null>(null);

  const appState = useRef<AppStateStatus>(AppState.currentState);

  const allDayEvents = useMemo(() => events.filter((e) => e.allDay), [events]);
  const timedEvents = useMemo(() => events.filter((e) => !e.allDay), [events]);

  async function requestPermission() {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    const ok = status === "granted";
    setPermissionGranted(ok);
    return ok;
  }

  async function loadSettings() {
    try {
      const [rawSel, rawWrite] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.selectedCalendarIds),
        AsyncStorage.getItem(STORAGE_KEYS.writeCalendarId),
      ]);
      const ids = rawSel ? (JSON.parse(rawSel) as string[]) : [];
      setSelectedIds(Array.isArray(ids) ? ids : []);
      setWriteCalId(rawWrite ?? null);
    } catch {
      setSelectedIds([]);
      setWriteCalId(null);
    }
  }

  async function saveSelected(ids: string[]) {
    setSelectedIds(ids);
    await AsyncStorage.setItem(STORAGE_KEYS.selectedCalendarIds, JSON.stringify(ids));
  }

  async function saveWriteCalendar(id: string, name: string) {
    setWriteCalId(id);
    setWriteCalName(name);
    await AsyncStorage.setItem(STORAGE_KEYS.writeCalendarId, id);
  }

  async function ensureDefaults(currentSelectedIds: string[], currentWriteId: string | null) {
    const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);

    if (currentSelectedIds.length === 0) {
      const ids =
        Platform.OS === "ios"
          ? cals.map((c) => c.id)
          : cals.filter((c) => c.allowsModifications).map((c) => c.id);

      await saveSelected(ids);
      currentSelectedIds = ids;
    }

    const preferred = cals.find((c) => c.allowsModifications) ?? cals[0];
    if (preferred && !currentWriteId) {
      await saveWriteCalendar(preferred.id, preferred.title ?? "Calendar");
      currentWriteId = preferred.id;
    } else if (currentWriteId) {
      const found = cals.find((c) => c.id === currentWriteId);
      setWriteCalName(found?.title ?? "Calendar");
    }
  }

  async function refresh(forceIds?: string[]) {
    const ok = permissionGranted || (await requestPermission());
    if (!ok) return;

    setLoading(true);
    try {
      const ids = forceIds ?? selectedIds;
      if (!ids || ids.length === 0) {
        setEvents([]);
        return;
      }

      const result = await Calendar.getEventsAsync(ids, startOfToday(), endOfToday());

      const mapped: CalEvent[] = (result || [])
        .filter((e) => !!e.startDate && !!e.endDate)
        .map((e) => ({
          id: e.id,
          title: e.title || "(No title)",
          startDate: new Date(e.startDate),
          endDate: new Date(e.endDate),
          allDay: !!(e as any).allDay,
          notes: (e as any).notes ?? undefined,
          location: (e as any).location ?? undefined,
          url: (e as any).url ?? undefined,
        }))
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

      setEvents(mapped);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setNewTitle("");
    setNewNotes("");
    setNewStart(roundToNext30(new Date()));
    setDurationMin(60);
    setPickerVisible(false);
    setAddOpen(true);
  }

  async function createEvent() {
    if (!writeCalId) return;
    const title = newTitle.trim();
    if (!title) return;

    const startDate = newStart;
    const endDate = new Date(startDate.getTime() + durationMin * 60 * 1000);

    try {
      await Calendar.createEventAsync(writeCalId, {
        title,
        startDate,
        endDate,
        notes: newNotes.trim() ? newNotes.trim() : undefined,
        timeZone: undefined,
      });
      setAddOpen(false);
      await refresh();
    } catch {
      // silent for now; we can add a toast later
    }
  }

  function onTimePickerChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === "android") setPickerVisible(false);
    if (event.type !== "set") return;
    setNewStart(selected ?? newStart);
  }

  function openDetails(e: CalEvent) {
    setActiveEvent(e);
    setDetailsOpen(true);
  }

  async function openInAppleCalendar(eventId: string) {
    // iOS: calshow:// is best; Android behavior varies
    // This won’t always jump to the exact event, but it reliably opens the calendar app.
    if (Platform.OS === "ios") {
      const url = `calshow:${Date.now() / 1000}`; // opens Calendar at current time
      const can = await Linking.canOpenURL(url);
      if (can) {
        await Linking.openURL(url);
        return;
      }
    }
    // Fallback: open a general calendar intent if possible (or do nothing)
    const fallback = Platform.OS === "android" ? "content://com.android.calendar/time/" : undefined;
    if (fallback) {
      const can = await Linking.canOpenURL(fallback);
      if (can) await Linking.openURL(fallback);
    }
  }

  useEffect(() => {
    (async () => {
      await loadSettings();
      const ok = await requestPermission();
      if (!ok) return;

      // ensure defaults using the freshest state values
      let ids: string[] = [];
      let writeId: string | null = null;

      try {
        const rawSel = await AsyncStorage.getItem(STORAGE_KEYS.selectedCalendarIds);
        ids = rawSel ? (JSON.parse(rawSel) as string[]) : [];
      } catch {
        ids = [];
      }
      try {
        writeId = (await AsyncStorage.getItem(STORAGE_KEYS.writeCalendarId)) ?? null;
      } catch {
        writeId = null;
      }

      await ensureDefaults(Array.isArray(ids) ? ids : [], writeId);
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh when coming back to foreground (so it stays in sync with Apple Calendar edits elsewhere)
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (next) => {
      const prev = appState.current;
      appState.current = next;

      if (prev.match(/inactive|background/) && next === "active") {
        if (permissionGranted) await refresh();
      }
    });

    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionGranted]);

  const headerRight = useMemo(() => {
    if (!permissionGranted) return "Connect";
    return loading ? "…" : "Refresh";
  }, [permissionGranted, loading]);

  async function onHeaderAction() {
    if (!permissionGranted) {
      const ok = await requestPermission();
      if (!ok) return;
      await ensureDefaults(selectedIds, writeCalId);
      await refresh();
      return;
    }
    await refresh();
  }

  const todayLine = fmtDateLine(new Date());

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={[styles.cardTitle, { fontFamily: titleFontFamily }]}>Today’s Schedule</Text>

        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable onPress={openAdd} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.7 }}>
            <Text style={[styles.headerAction, { fontFamily: uiFontFamily }]}>Add</Text>
          </Pressable>

          <Text style={{ width: 10 }} />

          <Pressable onPress={onHeaderAction} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.7 }}>
            <Text style={[styles.headerAction, { fontFamily: uiFontFamily }]}>{headerRight}</Text>
          </Pressable>
        </View>
      </View>

      <Text style={[styles.subHeader, { fontFamily: bodyFontFamily }]}>{todayLine}</Text>

      {!permissionGranted ? (
        <View style={styles.softBox}>
          <Text style={[styles.softTitle, { fontFamily: uiFontFamily }]}>Connect your calendar</Text>
          <Text style={[styles.softBody, { fontFamily: bodyFontFamily }]}>
            Homebase can show today’s events and add new ones to your Apple Calendar.
          </Text>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.softBox}>
          <Text style={[styles.softTitle, { fontFamily: uiFontFamily }]}>You’re clear today.</Text>
          <Text style={[styles.softBody, { fontFamily: bodyFontFamily }]}>
            No events found for today. Tap Add if you want to put something on the calendar.
          </Text>
        </View>
      ) : (
        <View style={{ marginTop: 12 }}>
          {allDayEvents.length > 0 ? (
            <View style={{ marginBottom: 10 }}>
              <Text style={[styles.groupLabel, { fontFamily: uiFontFamily }]}>All-day</Text>
              {allDayEvents.slice(0, 3).map((e) => (
                <Pressable key={e.id} onPress={() => openDetails(e)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <Text style={[styles.time, { fontFamily: uiFontFamily }]}>—</Text>
                  <Text style={[styles.title, { fontFamily: bodyFontFamily }]} numberOfLines={1}>
                    {e.title}
                  </Text>
                </Pressable>
              ))}
              {allDayEvents.length > 3 ? (
                <Text style={[styles.more, { fontFamily: uiFontFamily }]}>+{allDayEvents.length - 3} more all-day</Text>
              ) : null}
            </View>
          ) : null}

          {timedEvents.length > 0 ? (
            <View>
              <Text style={[styles.groupLabel, { fontFamily: uiFontFamily }]}>Timed</Text>
              {timedEvents.slice(0, 6).map((e) => (
                <Pressable key={e.id} onPress={() => openDetails(e)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <Text style={[styles.time, { fontFamily: uiFontFamily }]}>{fmtTime(e.startDate)}</Text>
                  <Text style={[styles.title, { fontFamily: bodyFontFamily }]} numberOfLines={1}>
                    {e.title}
                  </Text>
                </Pressable>
              ))}
              {timedEvents.length > 6 ? (
                <Text style={[styles.more, { fontFamily: uiFontFamily }]}>+{timedEvents.length - 6} more timed</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      )}

      {/* Add Event Modal */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { fontFamily: titleFontFamily }]}>Add to Calendar</Text>
              <Pressable onPress={() => setAddOpen(false)} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.7 }}>
                <Text style={[styles.modalClose, { fontFamily: uiFontFamily }]}>Close</Text>
              </Pressable>
            </View>

            <Text style={[styles.modalLabel, { fontFamily: uiFontFamily }]}>Title</Text>
            <TextInput
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="e.g., Pickup, Dentist, Practice"
              placeholderTextColor="rgba(28,22,18,0.35)"
              style={[styles.input, { fontFamily: bodyFontFamily }]}
            />

            <View style={{ height: 10 }} />

            <Text style={[styles.modalLabel, { fontFamily: uiFontFamily }]}>Start time</Text>
            <Pressable onPress={() => setPickerVisible(true)} style={({ pressed }) => [styles.pickerBtn, pressed && { opacity: 0.85 }]}>
              <Text style={[styles.pickerBtnText, { fontFamily: uiFontFamily }]}>
                {newStart.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
              </Text>
              <Text style={[styles.pickerHint, { fontFamily: bodyFontFamily }]}>Tap to change</Text>
            </Pressable>

            {pickerVisible ? (
              <View style={{ marginTop: 8 }}>
                <DateTimePicker
                  value={newStart}
                  mode="time"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={onTimePickerChange}
                />
                {Platform.OS === "ios" ? (
                  <Pressable onPress={() => setPickerVisible(false)} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}>
                    <Text style={[styles.primaryText, { fontFamily: uiFontFamily }]}>Done</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={{ height: 12 }} />

            <Text style={[styles.modalLabel, { fontFamily: uiFontFamily }]}>Duration</Text>
            <View style={styles.durationRow}>
              {[30, 60, 90].map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setDurationMin(m)}
                  style={({ pressed }) => [
                    styles.durationChip,
                    durationMin === m && styles.durationChipActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.durationText, { fontFamily: uiFontFamily }, durationMin === m && styles.durationTextActive]}>
                    {m}m
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={{ height: 12 }} />

            <Text style={[styles.modalLabel, { fontFamily: uiFontFamily }]}>Notes (optional)</Text>
            <TextInput
              value={newNotes}
              onChangeText={setNewNotes}
              placeholder="Anything you want to remember…"
              placeholderTextColor="rgba(28,22,18,0.35)"
              multiline
              style={[styles.notes, { fontFamily: bodyFontFamily }]}
            />

            <Text style={[styles.calendarHint, { fontFamily: bodyFontFamily }]}>
              Calendar: {writeCalName || "Default"}
            </Text>

            <Pressable
              onPress={createEvent}
              disabled={!newTitle.trim() || !writeCalId}
              style={({ pressed }) => [
                styles.primaryBtn,
                (!newTitle.trim() || !writeCalId) && { opacity: 0.45 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.primaryText, { fontFamily: uiFontFamily }]}>Add event</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Event Details Modal */}
      <Modal visible={detailsOpen} transparent animationType="fade" onRequestClose={() => setDetailsOpen(false)}>
        <View style={styles.detailsBackdrop}>
          <View style={styles.detailsCard}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { fontFamily: titleFontFamily }]} numberOfLines={2}>
                {activeEvent?.title ?? "Event"}
              </Text>
              <Pressable
                onPress={() => {
                  setDetailsOpen(false);
                  setActiveEvent(null);
                }}
                hitSlop={10}
                style={({ pressed }) => pressed && { opacity: 0.7 }}
              >
                <Text style={[styles.modalClose, { fontFamily: uiFontFamily }]}>Close</Text>
              </Pressable>
            </View>

            {activeEvent ? (
              <>
                <Text style={[styles.detailsLine, { fontFamily: bodyFontFamily }]}>
                  {activeEvent.allDay
                    ? "All-day"
                    : `${fmtTime(activeEvent.startDate)} – ${fmtTime(activeEvent.endDate)}  •  ${minutesBetween(
                        activeEvent.startDate,
                        activeEvent.endDate
                      )} min`}
                </Text>

                {activeEvent.location ? (
                  <Text style={[styles.detailsMeta, { fontFamily: bodyFontFamily }]}>📍 {activeEvent.location}</Text>
                ) : null}

                {activeEvent.notes ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={[styles.detailsLabel, { fontFamily: uiFontFamily }]}>Notes</Text>
                    <Text style={[styles.detailsNotes, { fontFamily: bodyFontFamily }]}>{activeEvent.notes}</Text>
                  </View>
                ) : null}

                <View style={styles.detailsBtnRow}>
                  <Pressable
                    onPress={() => {
                      setDetailsOpen(false);
                      setActiveEvent(null);
                    }}
                    style={({ pressed }) => [styles.detailsSecondaryBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={[styles.detailsSecondaryText, { fontFamily: uiFontFamily }]}>Done</Text>
                  </Pressable>

                  <View style={{ width: 10 }} />

                  <Pressable
                    onPress={() => openInAppleCalendar(activeEvent.id)}
                    style={({ pressed }) => [styles.detailsPrimaryBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={[styles.detailsPrimaryText, { fontFamily: uiFontFamily }]}>Open Calendar</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 24,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.08)",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 3 },
      default: {},
    }),
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  cardTitle: { fontSize: 17, color: "#1C1612" },
  headerAction: { fontSize: 13, color: "#1C1612", opacity: 0.55 },
  subHeader: { marginTop: 4, color: "#1C1612", opacity: 0.55, fontSize: 13 },

  softBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.10)",
    backgroundColor: "rgba(28,22,18,0.03)",
  },
  softTitle: { color: "rgba(28,22,18,0.78)" },
  softBody: { marginTop: 6, color: "rgba(28,22,18,0.55)" },

  groupLabel: { marginTop: 2, marginBottom: 6, color: "#1C1612", opacity: 0.55, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderRadius: 12 },
  time: { width: 72, color: "#1C1612", opacity: 0.75, fontSize: 13 },
  title: { flex: 1, color: "#1C1612", fontSize: 15 },
  more: { marginTop: 4, color: "#1C1612", opacity: 0.45 },
  pressed: { opacity: 0.7 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.10)",
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  modalTitle: { fontSize: 18, color: "#1C1612", flex: 1, paddingRight: 10 },
  modalClose: { fontSize: 13, color: "#1C1612", opacity: 0.55 },

  modalLabel: { marginTop: 12, marginBottom: 6, color: "#1C1612", opacity: 0.7 },

  input: {
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    color: "#1C1612",
    backgroundColor: "rgba(255,255,255,0.75)",
  },

  pickerBtn: {
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.75)",
  },
  pickerBtnText: { color: "#1C1612" },
  pickerHint: { marginTop: 4, color: "#1C1612", opacity: 0.5, fontSize: 12 },

  durationRow: { flexDirection: "row" },
  durationChip: {
    marginRight: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    backgroundColor: "rgba(28,22,18,0.03)",
  },
  durationChipActive: { backgroundColor: "rgba(28,22,18,0.10)", borderColor: "rgba(28,22,18,0.25)" },
  durationText: { color: "#1C1612", opacity: 0.75 },
  durationTextActive: { opacity: 1 },

  notes: {
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 90,
    color: "#1C1612",
    backgroundColor: "rgba(255,255,255,0.75)",
  },

  calendarHint: { marginTop: 10, color: "#1C1612", opacity: 0.45, fontSize: 12 },

  primaryBtn: { marginTop: 12, paddingVertical: 14, borderRadius: 16, backgroundColor: "#1C1612", alignItems: "center" },
  primaryText: { color: "#FFFFFF" },

  // Details modal
  detailsBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.30)", justifyContent: "center", padding: 18 },
  detailsCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.10)",
  },
  detailsLine: { marginTop: 6, color: "#1C1612", opacity: 0.7 },
  detailsMeta: { marginTop: 8, color: "#1C1612", opacity: 0.65 },
  detailsLabel: { marginTop: 10, color: "#1C1612", opacity: 0.6, fontSize: 12 },
  detailsNotes: { marginTop: 6, color: "#1C1612", opacity: 0.75, lineHeight: 20 },

  detailsBtnRow: { marginTop: 14, flexDirection: "row" },
  detailsSecondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(30,20,10,0.12)",
    backgroundColor: "rgba(255,255,255,0.75)",
    alignItems: "center",
  },
  detailsSecondaryText: { color: "#1C1612", opacity: 0.8 },
  detailsPrimaryBtn: { flex: 1, paddingVertical: 12, borderRadius: 16, backgroundColor: "#1C1612", alignItems: "center" },
  detailsPrimaryText: { color: "#FFFFFF" },
});