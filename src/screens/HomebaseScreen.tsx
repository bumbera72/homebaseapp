import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  TextInput,
  Platform,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";

import TodayScheduleCard from "../ui/TodayScheduleCard";
import EmptyState from "../ui/EmptyState";
import { theme } from "../ui/theme";

import {
  RootStackParamList,
  Task,
  DraftTask,
  RecipeItem,
  LinkRecipe,
  ArchivedTask,
  BrainCategory,
} from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

type TonightMode = "cook" | "leftovers" | "eatout";

const STORAGE_KEYS = {
  onDeck: "homebase:onDeckTasks:v2",
  later: "homebase:laterTasks:v1",

  rhythm: "homebase:dailyRhythm:v1",
  rhythmLastReset: "homebase:dailyRhythm:lastResetDate:v1",

  tonightMode: "homebase:tonightMode:v1",
  tonightRecipe: "homebase:tonightRecipe:v3",
  tonightRecipeDate: "homebase:tonightRecipeDate:v1",

  recipes: "homebase:recipes:v3",
  lastLinkId: "homebase:lastLinkId:v1",

  archive: "homebase:archive:v1",
  shopping: "homebase:shoppingList:v1",
};

function todayKeyLocal(d: Date = new Date()): string {
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

function modeLabel(m: TonightMode): string {
  if (m === "cook") return "Cook";
  if (m === "leftovers") return "Leftovers";
  return "Eat out";
}

function seasonalEmoji(d: Date = new Date()): string {
  const m = d.getMonth(); // 0-11
  const day = d.getDate();
  // Simple, subtle “easter egg”
  if (m === 11) return "🎄"; // December
  if (m === 9) return "🎃"; // October
  if (m === 10) return "🍂"; // November
  if (m === 1 && day >= 10) return "💗"; // Feb-ish
  if (m === 2) return "🌷"; // March
  if (m === 5) return "☀️"; // June
  return "✨";
}

function greetingWithName(firstName?: string) {
  const hour = new Date().getHours();
  const g = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const namePart = firstName ? `, ${firstName}` : "";
  return `${g}${namePart} ${seasonalEmoji()}`;
}

function inferCategory(title: string): BrainCategory {
  const t = title.toLowerCase();
  const hasAny = (words: string[]) => words.some((w) => t.includes(w));

  if (hasAny(["call", "phone", "text", "email", "message"])) return "Calls";
  if (hasAny(["grocery", "groceries", "costco", "walmart", "target", "heb", "kroger"])) return "Groceries";
  if (hasAny(["kid", "kids", "school", "teacher", "practice", "game", "daycare"])) return "Kids";
  if (hasAny(["dinner", "lunch", "breakfast", "meal", "cook", "recipe"])) return "Meals";
  if (hasAny(["return", "errand", "drop off", "pickup", "post office", "ups", "fedex"])) return "Errands";
  if (hasAny(["bill", "invoice", "budget", "tax", "paperwork", "form", "appointment", "renew"])) return "Admin";
  if (hasAny(["clean", "laundry", "dishes", "vacuum", "mop", "organize", "declutter"])) return "Home";

  return "Ideas";
}

// Safe defaults (only if storage is empty)
const DEFAULT_ON_DECK: Task[] = [
  { id: 1, title: "Call dentist", done: false, plan: "upnext", category: "Calls" },
  { id: 2, title: "Sign permission slip", done: false, plan: "today", category: "Kids" },
  { id: 3, title: "Return Amazon package", done: false, plan: "upnext", category: "Errands" },
];

const DEFAULT_RHYTHM: Task[] = [
  { id: 101, title: "Make beds", done: false },
  { id: 102, title: "Kitchen reset", done: false },
  { id: 103, title: "Move my body", done: false },
];

type UndoPayload = {
  task: Task;
  archivedId: string;
};

type ShoppingItem = { id: string; text: string; done: boolean };

export default function HomebaseScreen({ navigation }: Props) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const todayKey = useMemo(() => todayKeyLocal(), []);

  const [onDeckTasks, setOnDeckTasks] = useState<Task[]>(DEFAULT_ON_DECK);
  const [laterTasks, setLaterTasks] = useState<DraftTask[]>([]);
  const [dailyRhythm, setDailyRhythm] = useState<Task[]>(DEFAULT_RHYTHM);

  // Daily Rhythm customization
  const [rhythmEditOpen, setRhythmEditOpen] = useState(false);
  const [rhythmDraftTitles, setRhythmDraftTitles] = useState<string[]>([]);
  const [newRhythmTitle, setNewRhythmTitle] = useState("");

  // Confetti trigger (simple burst)
  const [confettiVisible, setConfettiVisible] = useState(false);
  const prevAllRhythmDoneRef = useRef<boolean>(false);

  const [tonightMode, setTonightMode] = useState<TonightMode>("cook");
  const [tonightRecipe, setTonightRecipe] = useState<RecipeItem | null>(null);

  const [brainText, setBrainText] = useState("");
  const [shoppingText, setShoppingText] = useState("");
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState<DraftTask[]>([]);

  const [activePickerTaskId, setActivePickerTaskId] = useState<string | null>(null);
  const [pickerDate, setPickerDate] = useState<Date>(new Date());
  const [pickerVisible, setPickerVisible] = useState(false);

  const [completedTodayTotal, setCompletedTodayTotal] = useState<number>(0);

  const [undoVisible, setUndoVisible] = useState(false);
  const [undoPayload, setUndoPayload] = useState<UndoPayload | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loaded, setLoaded] = useState(false);

  async function loadArchiveCountOnly(): Promise<number> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.archive);
      const list = raw ? (JSON.parse(raw) as ArchivedTask[]) : [];
      return list.filter((x) => x.completedDateKey === todayKey).length;
    } catch {
      return 0;
    }
  }

  function computeRecap(archiveCount: number, rhythm: Task[]) {
    const rhythmDone = rhythm.filter((t) => t.done).length;
    setCompletedTodayTotal(archiveCount + rhythmDone);
  }

  async function autosurfaceDueLaterToOnDeck(existingOnDeck: Task[], existingLater: DraftTask[]) {
    const tk = todayKeyLocal();
    const due = existingLater.filter((t) => t.dueDateKey && t.dueDateKey <= tk);
    if (due.length === 0) return { nextOnDeck: existingOnDeck, nextLater: existingLater, moved: false };

    const deckTitleSet = new Set(existingOnDeck.map((t) => normTitle(t.title)));
    const toAdd: Task[] = due
      .filter((d) => !deckTitleSet.has(normTitle(d.title)))
      .map((d) => ({
        id: 999999,
        title: d.title,
        done: false,
        category: d.category,
        dueDateKey: d.dueDateKey,
        plan: d.dueDateKey === tk ? "today" : "upnext",
      }));

    const nextOnDeck = normalizeOnDeckIds([...toAdd, ...existingOnDeck]);
    const nextLater = existingLater.filter((t) => !(t.dueDateKey && t.dueDateKey <= tk));
    return { nextOnDeck, nextLater, moved: true };
  }

  async function loadFromStorage() {
    const [
      rawOnDeck,
      rawLater,
      rawRhythm,
      rawRhythmReset,
      savedTonightMode,
      savedTonightRecipe,
      savedTonightRecipeDate,
      rawShopping,
    ] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.onDeck),
      AsyncStorage.getItem(STORAGE_KEYS.later),
      AsyncStorage.getItem(STORAGE_KEYS.rhythm),
      AsyncStorage.getItem(STORAGE_KEYS.rhythmLastReset),
      AsyncStorage.getItem(STORAGE_KEYS.tonightMode),
      AsyncStorage.getItem(STORAGE_KEYS.tonightRecipe),
      AsyncStorage.getItem(STORAGE_KEYS.tonightRecipeDate),
      AsyncStorage.getItem(STORAGE_KEYS.shopping),
    ]);

    let deck: Task[] = rawOnDeck ? (JSON.parse(rawOnDeck) as Task[]) : DEFAULT_ON_DECK;
    let later: DraftTask[] = rawLater ? (JSON.parse(rawLater) as DraftTask[]) : [];

    const surfaced = await autosurfaceDueLaterToOnDeck(deck, later);
    deck = surfaced.nextOnDeck;
    later = surfaced.nextLater;

    if (surfaced.moved) {
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.onDeck, JSON.stringify(deck)),
        AsyncStorage.setItem(STORAGE_KEYS.later, JSON.stringify(later)),
      ]);
    }

    setOnDeckTasks(deck);
    setLaterTasks(later);

    // Tonight mode
    if (savedTonightMode === "cook" || savedTonightMode === "leftovers" || savedTonightMode === "eatout") {
      setTonightMode(savedTonightMode);
    }

    // Tonight recipe resets daily
    const tonightKey = todayKeyLocal();
    const isTonightFresh = savedTonightRecipeDate === tonightKey;

    if (savedTonightRecipe && isTonightFresh) {
      try {
        setTonightRecipe(JSON.parse(savedTonightRecipe) as RecipeItem);
      } catch {
        setTonightRecipe(null);
      }
    } else {
      setTonightRecipe(null);
      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEYS.tonightRecipe),
        AsyncStorage.removeItem(STORAGE_KEYS.tonightRecipeDate),
      ]);
    }

    // Daily Rhythm reset daily
    const rhythmKey = todayKeyLocal();
    let rhythm = DEFAULT_RHYTHM;
    if (rawRhythm) {
      try {
        rhythm = JSON.parse(rawRhythm) as Task[];
      } catch {
        rhythm = DEFAULT_RHYTHM;
      }
    }

    const needsReset = !rawRhythmReset || rawRhythmReset !== rhythmKey;
    if (needsReset) {
      const resetRhythm = rhythm.map((t) => ({ ...t, done: false }));
      setDailyRhythm(resetRhythm);
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.rhythm, JSON.stringify(resetRhythm)),
        AsyncStorage.setItem(STORAGE_KEYS.rhythmLastReset, rhythmKey),
      ]);
      rhythm = resetRhythm;
    } else {
      setDailyRhythm(rhythm);
    }

    const archiveCount = await loadArchiveCountOnly();
    computeRecap(archiveCount, rhythm);

    try {
      const list = rawShopping ? (JSON.parse(rawShopping) as ShoppingItem[]) : [];
      setShoppingItems(Array.isArray(list) ? list : []);
    } catch {
      setShoppingItems([]);
    }
  }
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.shopping, JSON.stringify(shoppingItems)).catch(() => {});
  }, [shoppingItems, loaded]);

  useEffect(() => {
    (async () => {
      try {
        await loadFromStorage();
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;

      (async () => {
        try {
          const [rawOnDeck, rawLater, rawRhythm] = await Promise.all([
            AsyncStorage.getItem(STORAGE_KEYS.onDeck),
            AsyncStorage.getItem(STORAGE_KEYS.later),
            AsyncStorage.getItem(STORAGE_KEYS.rhythm),
          ]);

          if (cancelled) return;

          let deck: Task[] = rawOnDeck ? (JSON.parse(rawOnDeck) as Task[]) : [];
          let later: DraftTask[] = rawLater ? (JSON.parse(rawLater) as DraftTask[]) : [];

          const surfaced = await autosurfaceDueLaterToOnDeck(deck, later);
          deck = surfaced.nextOnDeck;
          later = surfaced.nextLater;

          if (surfaced.moved) {
            await Promise.all([
              AsyncStorage.setItem(STORAGE_KEYS.onDeck, JSON.stringify(deck)),
              AsyncStorage.setItem(STORAGE_KEYS.later, JSON.stringify(later)),
            ]);
          }

          setOnDeckTasks(deck);
          setLaterTasks(later);

          const rhythm: Task[] = rawRhythm ? (JSON.parse(rawRhythm) as Task[]) : DEFAULT_RHYTHM;
          setDailyRhythm(rhythm);

          const archiveCount = await loadArchiveCountOnly();
          computeRecap(archiveCount, rhythm);
        } catch {
          // ignore
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [todayKey])
  );

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.onDeck, JSON.stringify(onDeckTasks)).catch(() => {});
  }, [onDeckTasks, loaded]);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.later, JSON.stringify(laterTasks)).catch(() => {});
  }, [laterTasks, loaded]);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.rhythm, JSON.stringify(dailyRhythm)).catch(() => {});
    (async () => {
      const archiveCount = await loadArchiveCountOnly();
      computeRecap(archiveCount, dailyRhythm);
    })().catch(() => {});

    // Confetti burst when Daily Rhythm becomes fully complete
    const allDoneNow = dailyRhythm.length > 0 && dailyRhythm.every((t) => t.done);
    const wasAllDone = prevAllRhythmDoneRef.current;
    if (!wasAllDone && allDoneNow) {
      setConfettiVisible(true);
      setTimeout(() => setConfettiVisible(false), 1400);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    prevAllRhythmDoneRef.current = allDoneNow;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyRhythm, loaded]);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.tonightMode, tonightMode).catch(() => {});
  }, [tonightMode, loaded]);

  useEffect(() => {
    if (!loaded) return;

    (async () => {
      if (!tonightRecipe) {
        await Promise.all([
          AsyncStorage.removeItem(STORAGE_KEYS.tonightRecipe),
          AsyncStorage.removeItem(STORAGE_KEYS.tonightRecipeDate),
        ]);
        return;
      }

      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.tonightRecipe, JSON.stringify(tonightRecipe)),
        AsyncStorage.setItem(STORAGE_KEYS.tonightRecipeDate, todayKeyLocal()),
      ]);
    })().catch(() => {});
  }, [tonightRecipe, loaded]);

  // ----- Undo helpers -----
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

    const nextOnDeck = normalizeOnDeckIds([task, ...onDeckTasks]);
    setOnDeckTasks(nextOnDeck);
    await AsyncStorage.setItem(STORAGE_KEYS.onDeck, JSON.stringify(nextOnDeck));

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.archive);
      const list = raw ? (JSON.parse(raw) as ArchivedTask[]) : [];
      const filtered = list.filter((x) => x.id !== archivedId);
      await AsyncStorage.setItem(STORAGE_KEYS.archive, JSON.stringify(filtered));
    } catch {}

    const archiveCount = await loadArchiveCountOnly();
    computeRecap(archiveCount, dailyRhythm);

    setUndoVisible(false);
    setUndoPayload(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    Haptics.selectionAsync().catch(() => {});
  }

  // ----- Complete + archive -----
  async function completeOnDeck(taskId: number) {
    const task = onDeckTasks.find((t) => t.id === taskId);
    if (!task) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    const next = onDeckTasks.filter((t) => t.id !== taskId);
    setOnDeckTasks(next);
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

    const archiveCount = await loadArchiveCountOnly();
    computeRecap(archiveCount, dailyRhythm);

    showUndo(task, archivedId);
  }

  // ----- Daily Rhythm -----
  function toggleRhythm(taskId: number) {
    Haptics.selectionAsync().catch(() => {});
    setDailyRhythm((prev) => prev.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)));
  }

  function openRhythmEditor() {
    // Only edit titles; done state stays on the live list.
    setRhythmDraftTitles(dailyRhythm.map((t) => t.title));
    setNewRhythmTitle("");
    setRhythmEditOpen(true);
    Haptics.selectionAsync().catch(() => {});
  }

  function updateRhythmDraftTitle(index: number, title: string) {
    setRhythmDraftTitles((prev) => prev.map((t, i) => (i === index ? title : t)));
  }

  function removeRhythmDraftRow(index: number) {
    setRhythmDraftTitles((prev) => prev.filter((_, i) => i !== index));
    Haptics.selectionAsync().catch(() => {});
  }

  function moveRhythmDraftRow(index: number, dir: "up" | "down") {
  setRhythmDraftTitles((prev) => {
    const next = [...prev];
    const swapWith = dir === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= next.length) return prev;
    const tmp = next[index];
    next[index] = next[swapWith];
    next[swapWith] = tmp;
    return next;
  });
  Haptics.selectionAsync().catch(() => {});
}

  function addRhythmDraftRow() {
    const t = newRhythmTitle.trim();
    if (!t) return;
    setRhythmDraftTitles((prev) => [...prev, t]);
    setNewRhythmTitle("");
    Haptics.selectionAsync().catch(() => {});
  }

  async function saveRhythmEditor() {
    const cleaned = rhythmDraftTitles.map((t) => t.trim()).filter(Boolean);

    // Keep ids stable-ish but simple.
    const next: Task[] = cleaned.map((title, idx) => {
      const existing = dailyRhythm[idx];
      return {
        id: existing?.id ?? 1000 + idx,
        title,
        done: false,
      };
    });

    setDailyRhythm(next);
    setRhythmEditOpen(false);

    // Persist immediately to avoid any timing weirdness
    await AsyncStorage.setItem(STORAGE_KEYS.rhythm, JSON.stringify(next));
    await AsyncStorage.setItem(STORAGE_KEYS.rhythmLastReset, todayKeyLocal());

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  async function resetRhythmToDefault() {
    const reset = DEFAULT_RHYTHM.map((t) => ({ ...t, done: false }));
    setDailyRhythm(reset);
    setRhythmEditOpen(false);
    setRhythmDraftTitles([]);
    setNewRhythmTitle("");

    await AsyncStorage.setItem(STORAGE_KEYS.rhythm, JSON.stringify(reset));
    await AsyncStorage.setItem(STORAGE_KEYS.rhythmLastReset, todayKeyLocal());

    Haptics.selectionAsync().catch(() => {});
  }

  function promoteToFocus(taskId: number) {
    Haptics.selectionAsync().catch(() => {});
    setOnDeckTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, plan: "today" } : t)));
  }

  // ----- Recipe link helper (minimal) -----
  async function addLinkToLibraryAndSelect(link: LinkRecipe) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.recipes);
      const existing: RecipeItem[] = raw ? (JSON.parse(raw) as RecipeItem[]) : [];
      const next = [link, ...existing.filter((r) => r.id !== link.id)];

      await AsyncStorage.setItem(STORAGE_KEYS.recipes, JSON.stringify(next));
      await AsyncStorage.setItem(STORAGE_KEYS.lastLinkId, link.id);

      setTonightRecipe(link);
    } catch {
      setTonightRecipe(link);
    }
  }

  // ----- Shopping List helpers -----
  function addShoppingItem() {
    const text = shoppingText.trim();
    if (!text) return;
    const item: ShoppingItem = { id: `shop-${Date.now()}-${Math.random().toString(16).slice(2)}`, text, done: false };
    setShoppingItems((prev) => [item, ...prev]);
    setShoppingText("");
    Haptics.selectionAsync().catch(() => {});
  }

  function toggleShoppingItem(id: string) {
    setShoppingItems((prev) => prev.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
    Haptics.selectionAsync().catch(() => {});
  }

  function removeShoppingItem(id: string) {
    setShoppingItems((prev) => prev.filter((it) => it.id !== id));
    Haptics.selectionAsync().catch(() => {});
  }

  function clearShoppingDone() {
    setShoppingItems((prev) => prev.filter((it) => !it.done));
    Haptics.selectionAsync().catch(() => {});
  }

  // ----- Inline Brain Dump / Review -----
  function parseBrainDumpLines(text: string): string[] {
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function openReviewFromBrainDump() {
    const lines = parseBrainDumpLines(brainText);
    if (lines.length === 0) return;

    const drafts: DraftTask[] = lines.map((title, idx) => ({
      id: `draft-${Date.now()}-${idx}`,
      title,
      category: inferCategory(title),
      bucket: "Later",
      dueDateKey: undefined,
    }));

    setReviewDrafts(drafts);
    setReviewOpen(true);
    Haptics.selectionAsync().catch(() => {});
  }

  function updateReviewDraft(id: string, patch: Partial<DraftTask>) {
    setReviewDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function removeReviewDraft(id: string) {
    setReviewDrafts((prev) => prev.filter((d) => d.id !== id));
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
      updateReviewDraft(activePickerTaskId, { dueDateKey: todayKeyLocal(dt) });
    }
  }

  function closeIOSPicker() {
    setPickerVisible(false);
    setActivePickerTaskId(null);
  }

  async function addReviewToHomebase() {
    let existingOnDeck: Task[] = [];
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.onDeck);
      existingOnDeck = raw ? (JSON.parse(raw) as Task[]) : [];
    } catch {
      existingOnDeck = [];
    }

    const onDeckTitleSet = new Set(existingOnDeck.map((t) => normTitle(t.title)));

    const toAdd: Task[] = reviewDrafts
      .filter((d) => !onDeckTitleSet.has(normTitle(d.title)))
      .map((d) => ({
        id: 999999,
        title: d.title,
        done: false,
        category: d.category,
        dueDateKey: d.dueDateKey,
        plan: d.dueDateKey && d.dueDateKey === todayKey ? "today" : "upnext",
      }));

    const nextOnDeck = normalizeOnDeckIds([...toAdd, ...existingOnDeck]);
    await AsyncStorage.setItem(STORAGE_KEYS.onDeck, JSON.stringify(nextOnDeck));
    setOnDeckTasks(nextOnDeck);

    setBrainText("");
    setReviewDrafts([]);
    setReviewOpen(false);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  const { todayFocus, upNext } = useMemo(() => {
    const open = onDeckTasks.filter((t) => !t.done);
    const focus = open.filter((t) => t.plan === "today");
    const rest = open.filter((t) => t.plan !== "today");
    return { todayFocus: focus, upNext: rest };
  }, [onDeckTasks]);

  /* ---------------------------------------------------------------------- */
  /* KEY LAYOUT FIXES:
     - Header sits ABOVE columns in landscape.
     - Columns start with Schedule (left) + Brain Dump (right) so they align.
  /* ---------------------------------------------------------------------- */

  const Header = (
    <View style={styles.headerWrap}>
      <View>
        <Text style={styles.h1}>{greetingWithName("Kendall")}</Text>
        <Text style={styles.h2}>{todayLabel}</Text>
      </View>

      <Pressable
        onPress={() =>
          navigation.navigate("Recipes", {
            selectedId: tonightRecipe?.id ?? null,
            defaultFilter: "saved",
            onSelect: (r: RecipeItem) => setTonightRecipe(r),
          })
        }
        style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
      >
        <Text style={styles.headerBtnText}>Recipes</Text>
      </Pressable>
    </View>
  );

  const BrainDumpCard = (
    <View style={styles.card}>
      <View style={styles.cardTitleRow}>
        <View style={[styles.cardAccent, { backgroundColor: theme.colors.blush }]} />
        <Text style={styles.cardTitle}>Brain Dump</Text>
      </View>
      <Text style={styles.helperText}>One line = one task. Paste a whole list if you want.</Text>

      <TextInput
        value={brainText}
        onChangeText={setBrainText}
        placeholder="Dump it here…"
        placeholderTextColor={theme.colors.ink3}
        multiline
        style={styles.brainInput}
      />

      <View style={styles.brainBtnRow}>
        <Pressable
          onPress={openReviewFromBrainDump}
          disabled={parseBrainDumpLines(brainText).length === 0}
          style={({ pressed }) => [
            styles.primaryBtn,
            styles.brainBtn,
            parseBrainDumpLines(brainText).length === 0 && { opacity: 0.45 },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.primaryBtnText}>Sort & Review</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            setBrainText("");
            setReviewOpen(false);
            setReviewDrafts([]);
          }}
          style={({ pressed }) => [styles.secondaryBtn, styles.brainBtn, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryBtnText}>Clear</Text>
        </Pressable>
      </View>

      {reviewOpen ? (
        <View style={styles.reviewCard}>
          <View style={styles.reviewHeader}>
            <View style={styles.cardTitleRow}>
              <View style={[styles.cardAccent, { backgroundColor: theme.colors.blush }]} />
              <Text style={styles.cardTitle}>Quick Review</Text>
            </View>
            <Pressable onPress={() => setReviewOpen(false)} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.7 }}>
              <Text style={styles.reviewClose}>Close</Text>
            </Pressable>
          </View>

          <Text style={styles.helperText}>Pick a timing only if it helps. Due today → Today. Everything else → Coming up.</Text>

          {reviewDrafts.map((d) => {
            const dueLabel = d.dueDateKey ? formatDueLabel(d.dueDateKey) : "";
            const goesTo = d.dueDateKey && d.dueDateKey === todayKey ? "Today" : "Coming up";

            return (
              <View key={d.id} style={styles.reviewItem}>
                <View style={styles.reviewTitleRow}>
                  <View style={styles.reviewTitleLeft}>
                    <Text style={styles.reviewTitle} numberOfLines={1}>
                      {d.title}
                    </Text>

                    {d.category ? (
                      <View style={styles.inlineCategoryPill}>
                        <Text style={styles.inlineCategoryText}>{String(d.category)}</Text>
                      </View>
                    ) : null}
                  </View>

                  <Pressable onPress={() => removeReviewDraft(d.id)} hitSlop={10}>
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>

                <View style={styles.reviewMetaRow}>
                  <Text style={styles.goesToText}>{goesTo}</Text>
                  {d.dueDateKey ? (
                    <Text style={[styles.inlineDue, isOverdue(d.dueDateKey) && styles.inlineDueOverdue]}>
                      {isOverdue(d.dueDateKey) ? `Due ${dueLabel}` : dueLabel}
                    </Text>
                  ) : (
                    <Text style={[styles.inlineDue, styles.inlineDueEmpty]}>—</Text>
                  )}
                </View>

                <View style={styles.chipRow}>
                  <Chip label="Today" onPress={() => updateReviewDraft(d.id, { dueDateKey: todayKey })} />
                  <Chip label="Tomorrow" onPress={() => updateReviewDraft(d.id, { dueDateKey: addDaysKey(1) })} />
                  <Chip label="This week" onPress={() => updateReviewDraft(d.id, { dueDateKey: addDaysKey(3) })} />
                  <Chip label="Pick date" onPress={() => openPickerFor(d.id)} />
                  <Chip label="No date" onPress={() => updateReviewDraft(d.id, { dueDateKey: undefined })} faint />
                </View>
              </View>
            );
          })}

          <Pressable onPress={addReviewToHomebase} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}>
            <Text style={styles.primaryBtnText}>Add to Homebase</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const ShoppingListCard = (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <View style={[styles.cardAccent, { backgroundColor: theme.colors.mist }]} />
          <Text style={styles.cardTitle}>Shopping List</Text>
        </View>

        {shoppingItems.some((x) => x.done) ? (
          <Pressable onPress={clearShoppingDone} hitSlop={10} style={({ pressed }) => [styles.viewAllBtn, pressed && styles.pressed]}>
            <Text style={styles.viewAllText}>Clear done</Text>
          </Pressable>
        ) : (
          <View />
        )}
      </View>

      <Text style={styles.helperText}>Quick add what you need. Tap to check off.</Text>

      <View style={styles.shoppingRow}>
        <TextInput
          value={shoppingText}
          onChangeText={setShoppingText}
          placeholder="Add an item…"
          placeholderTextColor={theme.colors.ink3}
          style={styles.shoppingInput}
          returnKeyType="done"
          onSubmitEditing={addShoppingItem}
        />

        <Pressable onPress={addShoppingItem} style={({ pressed }) => [styles.primaryBtn, styles.shoppingAddBtn, pressed && { opacity: 0.85 }]}>
          <Text style={styles.primaryBtnText}>Add</Text>
        </Pressable>
      </View>

      {shoppingItems.length === 0 ? (
        <View style={styles.softBox}>
          <Text style={styles.softBoxTitle}>Nothing here yet.</Text>
          <Text style={styles.softBoxBody}>Add a few staples so future-you doesn’t have to remember.</Text>
        </View>
      ) : (
        <View style={{ marginTop: 10 }}>
          {shoppingItems.slice(0, 12).map((it) => (
            <View key={it.id} style={styles.shoppingItemRow}>
              <Pressable onPress={() => toggleShoppingItem(it.id)} style={({ pressed }) => [styles.shoppingLeft, pressed && styles.pressed]}>
                <Text style={styles.checkbox}>{it.done ? "☑" : "☐"}</Text>
                <Text style={[styles.rowText, it.done && styles.doneText]} numberOfLines={1}>
                  {it.text}
                </Text>
              </Pressable>

              <Pressable onPress={() => removeShoppingItem(it.id)} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.7 }}>
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          ))}

          {shoppingItems.length > 12 ? (
            <Text style={styles.moreText}>+{shoppingItems.length - 12} more</Text>
          ) : null}
        </View>
      )}
    </View>
  );

  const TasksCard = (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <View style={[styles.cardAccent, { backgroundColor: theme.colors.sage }]} />
          <Text style={styles.cardTitle}>To Take Care Of</Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate("OnDeck", { tasks: onDeckTasks, onUpdate: setOnDeckTasks })}
          hitSlop={10}
          style={({ pressed }) => [styles.viewAllBtn, pressed && styles.pressed]}
        >
          <Text style={styles.viewAllText}>View all</Text>
        </Pressable>
      </View>

      <Text style={styles.helperText}>
        {completedTodayTotal >= 5
          ? "Okay productivity queen 👑"
          : completedTodayTotal > 0
            ? "You’re making progress. Keep going 💛"
            : "Tiny wins count. Check off one thing when you’re ready."}
      </Text>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Today</Text>
        <Text style={styles.sectionHint}>(max 5)</Text>
      </View>

      {todayFocus.length === 0 ? (
        <View style={styles.softBox}>
          <Text style={styles.softBoxTitle}>You’re caught up.</Text>
          <Text style={styles.softBoxBody}>Pull one up from Coming up when you’re ready.</Text>
        </View>
      ) : (
        <View style={{ marginTop: 10 }}>
          {todayFocus.slice(0, 5).map((task) => (
            <Pressable
              key={`${task.id}-${task.title}`}
              onPress={() => completeOnDeck(task.id)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.checkbox}>☐</Text>
              <Text style={styles.rowText}>{task.title}</Text>
              {task.dueDateKey ? (
                <Text style={[styles.inlineDue, isOverdue(task.dueDateKey) && styles.inlineDueOverdue]}>
                  {isOverdue(task.dueDateKey) ? `Due ${formatDueLabel(task.dueDateKey)}` : formatDueLabel(task.dueDateKey)}
                </Text>
              ) : (
                <Text style={[styles.inlineDue, styles.inlineDueEmpty]}>—</Text>
              )}
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.divider} />

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Coming up</Text>
        <Text style={styles.sectionHint}>{upNext.length > 0 ? `${upNext.length} active` : ""}</Text>
      </View>

      {upNext.length === 0 ? (
        <EmptyState title="Nothing waiting right now." subtitle="Brain dump anything to keep on your radar." />
      ) : (
        <View style={{ marginTop: 10 }}>
          {upNext.slice(0, 3).map((task) => (
            <View key={`${task.id}-${task.title}`} style={styles.upNextRow}>
              <Pressable
                onPress={() => completeOnDeck(task.id)}
                style={({ pressed }) => [styles.upNextLeft, pressed && styles.pressed]}
              >
                <Text style={styles.checkbox}>☐</Text>
                <Text style={styles.rowTextMuted}>{task.title}</Text>
                {task.dueDateKey ? (
                  <Text style={[styles.inlineDue, isOverdue(task.dueDateKey) && styles.inlineDueOverdue]}>
                    {isOverdue(task.dueDateKey) ? `Due ${formatDueLabel(task.dueDateKey)}` : formatDueLabel(task.dueDateKey)}
                  </Text>
                ) : (
                  <Text style={[styles.inlineDue, styles.inlineDueEmpty]}>—</Text>
                )}
              </Pressable>

              <Pressable
                onPress={() => promoteToFocus(task.id)}
                hitSlop={10}
                style={({ pressed }) => [styles.focusBtn, pressed && styles.pressed]}
              >
                <Text style={styles.focusBtnText}>Today</Text>
              </Pressable>
            </View>
          ))}

          {upNext.length > 3 ? (
            <Pressable
              onPress={() => navigation.navigate("OnDeck", { tasks: onDeckTasks, onUpdate: setOnDeckTasks })}
              hitSlop={10}
              style={({ pressed }) => pressed && { opacity: 0.7 }}
            >
              <Text style={styles.moreText}>+{upNext.length - 3} more in View all</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <Text style={styles.helperText}>Completed today: {completedTodayTotal}</Text>
    </View>
  );

  const DailyRhythmCard = (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <View style={[styles.cardAccent, { backgroundColor: theme.colors.mist }]} />
          <Text style={styles.cardTitle}>Daily Rhythm</Text>
        </View>

        <Pressable
          onPress={openRhythmEditor}
          hitSlop={10}
          style={({ pressed }) => [styles.viewAllBtn, pressed && styles.pressed]}
        >
          <Text style={styles.viewAllText}>{rhythmEditOpen ? "Editing" : "Edit"}</Text>
        </Pressable>
      </View>

      {rhythmEditOpen ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.helperText}>Resets every morning.</Text>
          <Text style={styles.rhythmMicrocopy}>Choose tiny resets that make the day feel lighter.</Text>

          {rhythmDraftTitles.map((title, idx) => (
            <View key={`rhythm-edit-${idx}`} style={styles.rhythmEditRow}>
              <TextInput
                value={title}
                onChangeText={(t) => updateRhythmDraftTitle(idx, t)}
                placeholder={`Task ${idx + 1}`}
                placeholderTextColor={theme.colors.ink3}
                style={styles.rhythmEditInput}
              />

              <View style={styles.rhythmRowActions}>
                <Pressable
                  onPress={() => moveRhythmDraftRow(idx, "up")}
                  disabled={idx === 0}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.rhythmReorderBtn,
                    idx === 0 && { opacity: 0.35 },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.rhythmReorderText}>↑</Text>
                </Pressable>

                <Pressable
                  onPress={() => moveRhythmDraftRow(idx, "down")}
                  disabled={idx === rhythmDraftTitles.length - 1}
                  hitSlop={10}
                  style={({ pressed }) => [
                    styles.rhythmReorderBtn,
                    idx === rhythmDraftTitles.length - 1 && { opacity: 0.35 },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.rhythmReorderText}>↓</Text>
                </Pressable>

                <Pressable onPress={() => removeRhythmDraftRow(idx)} hitSlop={10} style={({ pressed }) => pressed && { opacity: 0.7 }}>
                  <Text style={styles.removeText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}

          <View style={styles.rhythmAddRow}>
            <TextInput
              value={newRhythmTitle}
              onChangeText={setNewRhythmTitle}
              placeholder="Add a new rhythm task…"
              placeholderTextColor={theme.colors.ink3}
              style={styles.rhythmAddInput}
              returnKeyType="done"
              onSubmitEditing={addRhythmDraftRow}
            />
            <Pressable onPress={addRhythmDraftRow} style={({ pressed }) => [styles.secondaryBtn, styles.rhythmAddBtn, pressed && styles.pressed]}>
              <Text style={styles.secondaryBtnText}>Add</Text>
            </Pressable>
          </View>

          <View style={styles.rhythmEditActions}>
            <View style={styles.rhythmEditActionsRow}>
              <Pressable
                onPress={() => {
                  setRhythmEditOpen(false);
                  setRhythmDraftTitles([]);
                  setNewRhythmTitle("");
                }}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  styles.rhythmActionBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={resetRhythmToDefault}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  styles.rhythmActionBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.secondaryBtnText}>Reset</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={saveRhythmEditor}
              style={({ pressed }) => [
                styles.primaryBtn,
                styles.rhythmSaveBtn,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.primaryBtnText}>Save</Text>
            </Pressable>
          </View>
        </View>
      ) : dailyRhythm.length > 0 && dailyRhythm.every((t) => t.done) ? (
        <View style={styles.rhythmDoneBox}>
          {confettiVisible ? <ConfettiBurst /> : null}
          <Text style={styles.rhythmConfetti}>🎉</Text>
          <Text style={styles.softBoxTitle}>Daily Rhythm complete.</Text>
          <Text style={styles.softBoxBody}>That little reset changes everything. Go you.</Text>
        </View>
      ) : dailyRhythm.length === 0 ? (
        <View style={styles.rhythmDoneBox}>
          <Text style={styles.rhythmConfetti}>🎊</Text>
          <Text style={styles.softBoxTitle}>No rhythm yet.</Text>
          <Text style={styles.softBoxBody}>Tap Edit to add a few tiny resets you want to repeat daily.</Text>
        </View>
      ) : (
        <View style={{ marginTop: 12 }}>
          {dailyRhythm.map((item) => (
            <Pressable
              key={`${item.id}-${item.title}`}
              onPress={() => toggleRhythm(item.id)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.checkbox}>{item.done ? "☑" : "☐"}</Text>
              <Text style={[styles.rowText, item.done && styles.doneText]}>{item.title}</Text>
            </Pressable>
          ))}
          <Text style={styles.helperText}>Resets every morning.</Text>
        </View>
      )}
    </View>
  );

  const TonightCard = (
    <View style={styles.card}>
      <View style={styles.tonightHeader}>
        <View style={styles.cardTitleRow}>
          <View style={[styles.cardAccent, { backgroundColor: theme.colors.sage }]} />
          <Text style={styles.cardTitle}>Tonight</Text>
        </View>
        <Text style={styles.tonightMeta}>{modeLabel(tonightMode)}</Text>
      </View>

      <View style={styles.tonightModeRow}>
        <Pressable
          onPress={() => setTonightMode("cook")}
          style={({ pressed }) => [styles.modeBtn, tonightMode === "cook" && styles.modeBtnActive, pressed && styles.pressed]}
        >
          <Text style={[styles.modeBtnText, tonightMode === "cook" && styles.modeBtnTextActive]}>Cook</Text>
        </Pressable>

        <View style={styles.modeBtnSpacer} />

        <Pressable
          onPress={() => setTonightMode("leftovers")}
          style={({ pressed }) => [styles.modeBtn, tonightMode === "leftovers" && styles.modeBtnActive, pressed && styles.pressed]}
        >
          <Text style={[styles.modeBtnText, tonightMode === "leftovers" && styles.modeBtnTextActive]}>Leftovers</Text>
        </Pressable>

        <View style={styles.modeBtnSpacer} />

        <Pressable
          onPress={() => setTonightMode("eatout")}
          style={({ pressed }) => [styles.modeBtn, tonightMode === "eatout" && styles.modeBtnActive, pressed && styles.pressed]}
        >
          <Text style={[styles.modeBtnText, tonightMode === "eatout" && styles.modeBtnTextActive]}>Eat out</Text>
        </Pressable>
      </View>

      {tonightMode === "cook" ? (
        <View style={styles.cookBox}>
          {(() => {
            const hasRecipe = !!tonightRecipe && !!tonightRecipe.title;

            const title = hasRecipe ? tonightRecipe!.title : "What’s for dinner?";
            const subtitle = hasRecipe
              ? tonightRecipe!.kind === "structured"
                ? "Saved recipe • Cooking Mode available"
                : "Recipe link • Opens in the built-in viewer"
              : "Pick a saved recipe or paste a link.";

            const primaryLabel = !hasRecipe
              ? ""
              : tonightRecipe!.kind === "structured"
                ? "Start Cooking Mode"
                : "Open recipe link";

            return (
              <>
                <Text style={styles.cookTitle}>{title}</Text>
                <Text style={styles.helperTextCenter}>{subtitle}</Text>

                <View style={styles.cookBtnRow}>
                  <Pressable
                    onPress={() =>
                      navigation.navigate("Recipes", {
                        selectedId: tonightRecipe?.id ?? null,
                        defaultFilter: "saved",
                        onSelect: (r: RecipeItem) => setTonightRecipe(r),
                      })
                    }
                    style={({ pressed }) => [styles.secondaryBtn, styles.cookBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryBtnText}>Choose a recipe</Text>
                  </Pressable>

                  <View style={{ width: 10 }} />

                  <Pressable
                    onPress={() =>
                      navigation.navigate("AddRecipeLink", {
                        onCreate: (link: LinkRecipe) => addLinkToLibraryAndSelect(link),
                      })
                    }
                    style={({ pressed }) => [styles.secondaryBtn, styles.cookBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryBtnText}>Paste a recipe link</Text>
                  </Pressable>
                </View>

                {hasRecipe ? (
                  <Pressable
                    onPress={() => {
                      if (tonightRecipe!.kind === "link") {
                        navigation.navigate("RecipeLink", { recipe: tonightRecipe! });
                      } else {
                        navigation.navigate("Cooking", { recipe: tonightRecipe! });
                      }
                    }}
                    style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
                  </Pressable>
                ) : null}
              </>
            );
          })()}
        </View>
      ) : (
        <View style={styles.softBox}>
          <Text style={styles.softBoxTitle}>Love that. Keep it easy tonight.</Text>
          <Text style={styles.softBoxBody}>Homebase will be here for you tomorrow.</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        {Header}

        {isLandscape ? (
          <View style={styles.landscapeRow}>
            <View style={styles.leftColumn}>
              <TodayScheduleCard
                titleFontFamily={theme.type.h1.fontFamily}
                bodyFontFamily={theme.type.body.fontFamily}
                uiFontFamily={theme.type.ui.fontFamily}
              />
              {TasksCard}
              {DailyRhythmCard}
              {TonightCard}
            </View>

            <View style={styles.rightColumn}>
              {/* This makes Brain Dump top align with TodayScheduleCard */}
              <View style={{ marginTop: 0 }}>{BrainDumpCard}</View>
              {ShoppingListCard}
            </View>
          </View>
        ) : (
          <>
            <TodayScheduleCard
              titleFontFamily={theme.type.h1.fontFamily}
              bodyFontFamily={theme.type.body.fontFamily}
              uiFontFamily={theme.type.ui.fontFamily}
            />
            {TasksCard}
            {DailyRhythmCard}
            {TonightCard}
            {BrainDumpCard}
            {ShoppingListCard}
          </>
        )}
      </ScrollView>

      {pickerVisible ? (
        <View style={styles.pickerSheet}>
          <Text style={styles.cardTitle}>Pick a due date</Text>
          <Text style={styles.helperText}>Only set this if it actually matters.</Text>

          <View style={{ marginTop: 10 }}>
            <DateTimePicker
              value={pickerDate}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={onPickerChange}
            />
          </View>

          {Platform.OS === "ios" ? (
            <Pressable
              onPress={closeIOSPicker}
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.primaryBtnText}>Done</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {undoVisible && undoPayload ? (
        <View style={styles.snackbarWrap} pointerEvents="box-none">
          <View style={styles.snackbar}>
            <Text style={styles.snackbarText} numberOfLines={2}>
              Completed: {undoPayload.task.title}
            </Text>
            <Pressable
              onPress={undoLastComplete}
              hitSlop={10}
              style={({ pressed }) => pressed && { opacity: 0.75 }}
            >
              <Text style={styles.snackbarUndo}>Undo</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Small UI helpers */
/* -------------------------------------------------------------------------- */

function ConfettiBurst() {
  // Tiny, dependency-free confetti burst for the celebration box.
  const pieces = useMemo(() => Array.from({ length: 16 }, (_, i) => i), []);
  const anim = useRef(new (require("react-native").Animated.Value)(0)).current;

  useEffect(() => {
    anim.setValue(0);
    require("react-native").Animated.timing(anim, {
      toValue: 1,
      duration: 1200,
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { Animated } = require("react-native");

  return (
    <View pointerEvents="none" style={styles.confettiWrap}>
      {pieces.map((i) => {
        const x = (i % 8) * 18 - 60;
        const delay = (i % 6) * 60;
        const translateY = anim.interpolate({
          inputRange: [0, 1],
          outputRange: [-10, 110],
        });
        const translateX = anim.interpolate({
          inputRange: [0, 1],
          outputRange: [x, x + (i % 2 === 0 ? 18 : -18)],
        });
        const rotate = anim.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", i % 2 === 0 ? "120deg" : "-120deg"],
        });
        const opacity = anim.interpolate({
          inputRange: [0, 0.2, 1],
          outputRange: [0, 1, 0],
        });

        return (
          <Animated.View
            key={`conf-${i}`}
            style={{
              position: "absolute",
              top: 0,
              left: "50%",
              width: 8,
              height: 12,
              borderRadius: 3,
              backgroundColor: i % 3 === 0 ? theme.colors.blush : i % 3 === 1 ? theme.colors.mist : theme.colors.sage,
              opacity,
              transform: [
                { translateX },
                { translateY },
                { rotate },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

function Chip({ label, onPress, faint }: { label: string; onPress: () => void; faint?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        faint ? styles.chipFaint : null,
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text style={[styles.chipText, faint ? styles.chipTextFaint : null]}>{label}</Text>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  container: { padding: 24, paddingBottom: 80 },

  // Header row fixes “Recipes button floating”
  headerWrap: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  h1: { fontSize: 24, color: theme.colors.ink, ...theme.type.h1 },
  h2: { marginTop: 4, fontSize: 15, color: theme.colors.ink3, ...theme.type.body },

  headerBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.secondaryBorder,
    backgroundColor: theme.colors.secondaryFill,
  },
  headerBtnText: { color: theme.colors.ink, ...theme.type.ui },

  landscapeRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 12 },
  leftColumn: { flex: 5, paddingRight: 10 },
  rightColumn: { flex: 5, paddingLeft: 10, minWidth: 420, maxWidth: 700 },

  card: {
    marginTop: 16,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow,
  },

  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  cardTitle: { fontSize: 17, color: theme.colors.ink, ...theme.type.h2 },
  cardTitleRow: { flexDirection: "row", alignItems: "center" },
  cardAccent: {
    width: 4,
    height: 16,
    borderRadius: 999,
    marginRight: 10,
  },

  viewAllBtn: { paddingVertical: 4, paddingHorizontal: 6, borderRadius: 10 },
  viewAllText: { fontSize: 13, color: theme.colors.ink3, ...theme.type.ui },

  helperText: { marginTop: 6, fontSize: 13, color: theme.colors.ink3, ...theme.type.body },
  helperTextCenter: { marginTop: 6, fontSize: 13, color: theme.colors.ink3, ...theme.type.body, textAlign: "center" },

  // Rows
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderRadius: 12 },
  checkbox: { width: 28, fontSize: 18, color: theme.colors.ink },

  rowText: { flex: 1, fontSize: 16, color: theme.colors.ink, ...theme.type.body },
  rowTextMuted: { flex: 1, fontSize: 16, color: theme.colors.ink2, ...theme.type.body },
  doneText: { opacity: 0.55, textDecorationLine: "line-through" },

  inlineDue: {
    width: 78,
    textAlign: "right",
    marginLeft: 10,
    fontSize: 12,
    color: theme.colors.ink3,
    ...theme.type.bold,
  },
  inlineDueEmpty: { opacity: 0 },

  inlineDueOverdue: { opacity: 0.9 },

  sectionHeaderRow: { marginTop: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  sectionTitle: { fontSize: 15, color: theme.colors.ink, ...theme.type.h2 },
  sectionHint: { fontSize: 13, color: theme.colors.ink3, ...theme.type.ui },

  softBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.softFill,
  },
  softBoxTitle: { color: theme.colors.ink2, ...theme.type.bold },
  softBoxBody: { marginTop: 4, color: theme.colors.ink3, ...theme.type.body },

  divider: { marginTop: 14, marginBottom: 12, height: 1, backgroundColor: theme.colors.hairline },

  upNextRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  upNextLeft: { flexDirection: "row", alignItems: "center", flex: 1 },

  focusBtn: {
    marginLeft: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.secondaryBorder,
    backgroundColor: theme.colors.secondaryFill,
  },
  focusBtnText: { color: theme.colors.ink, ...theme.type.bold, opacity: 0.8 },

  moreText: { marginTop: 2, color: theme.colors.ink3, ...theme.type.ui },

  // Buttons (theme-based)
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.primaryFill,
    borderWidth: 1,
    borderColor: theme.colors.primaryBorder,
    alignItems: "center",
  },
  primaryBtnText: { color: theme.colors.primaryText, ...theme.type.bold },

  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.secondaryBorder,
    backgroundColor: theme.colors.secondaryFill,
    alignItems: "center",
  },
  secondaryBtnText: { color: theme.colors.secondaryText, ...theme.type.bold, opacity: 0.9 },

  // Brain input
  brainInput: {
    marginTop: 12,
    minHeight: 200,
    maxHeight: 320,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.softFill,
    padding: 12,
    color: theme.colors.ink,
    fontSize: 16,
    ...theme.type.body,
  },
  brainBtnRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brainBtn: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: 14,
  },

  // Review
  reviewCard: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
  },
  reviewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  reviewClose: { fontSize: 13, color: theme.colors.ink3, ...theme.type.bold },

  reviewItem: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.hairline },
  reviewTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reviewTitleLeft: { flex: 1, flexDirection: "row", alignItems: "center", marginRight: 10 },
  reviewTitle: { flexShrink: 1, fontSize: 16, color: theme.colors.ink, ...theme.type.bold },

  reviewMetaRow: { marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  goesToText: { color: theme.colors.ink3, ...theme.type.ui },

  removeText: { fontSize: 13, color: theme.colors.ink3, ...theme.type.bold },

  inlineCategoryPill: {
    marginLeft: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.softFill,
  },
  inlineCategoryText: { fontSize: 12, color: theme.colors.ink3, ...theme.type.bold },

  chipRow: { marginTop: 12, flexDirection: "row", flexWrap: "wrap" },
  chip: {
    marginRight: 10,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  chipFaint: { backgroundColor: theme.colors.softFill },
  chipText: { color: theme.colors.ink2, ...theme.type.bold },
  chipTextFaint: { opacity: 0.65 },

  // Tonight
  tonightHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  tonightMeta: { fontSize: 13, color: theme.colors.ink3, ...theme.type.ui },

  tonightModeRow: { marginTop: 12, flexDirection: "row" },
  modeBtnSpacer: { width: 10 },

  modeBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: "center",
  },
  modeBtnActive: { borderColor: theme.colors.primaryBorder, backgroundColor: theme.colors.primaryFill },
  modeBtnText: { color: theme.colors.ink3, ...theme.type.ui },
  modeBtnTextActive: { color: theme.colors.ink, opacity: 1 },

  cookBox: {
    marginTop: 14,
    padding: 14,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.softFill,
  },
  cookTitle: { marginTop: 2, fontSize: 16, color: theme.colors.ink, ...theme.type.h2, textAlign: "center" },
  cookBtnRow: { marginTop: 12, flexDirection: "row" },
  cookBtn: { flex: 1 },

  // Picker
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
  },

  // Snackbar (undo)
  snackbarWrap: { position: "absolute", left: 0, right: 0, bottom: 18, alignItems: "center" },
  snackbar: {
    width: "92%",
    maxWidth: 520,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.inkFill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  snackbarText: { color: theme.colors.inkText, ...theme.type.ui, flex: 1, marginRight: 12 },
  snackbarUndo: { color: theme.colors.inkText, ...theme.type.bold, opacity: 0.95 },

  pressed: { opacity: 0.7 },
  // Shopping List
  shoppingRow: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  shoppingInput: {
    flex: 1,
    height: 46,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.softFill,
    paddingHorizontal: 12,
    color: theme.colors.ink,
    ...theme.type.body,
  },
  shoppingAddBtn: { marginTop: 0, paddingVertical: 12, paddingHorizontal: 14 },
  shoppingItemRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  shoppingLeft: { flexDirection: "row", alignItems: "center", flex: 1, paddingRight: 10 },

  // Daily Rhythm editor (additional for reorder)
  rhythmRowActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  rhythmReorderBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.secondaryBorder,
    backgroundColor: theme.colors.secondaryFill,
    alignItems: "center",
    justifyContent: "center",
  },
  rhythmReorderText: {
    color: theme.colors.ink2,
    ...theme.type.bold,
    fontSize: 14,
    opacity: 0.9,
  },

  // Daily Rhythm celebration
  rhythmDoneBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.primaryBorder,
    backgroundColor: theme.colors.primaryFill,
    alignItems: "center",
    overflow: "hidden",
  },
  rhythmConfetti: { fontSize: 34, marginBottom: 6 },

  // Daily Rhythm editor
  rhythmEditRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  rhythmEditInput: {
    flex: 1,
    height: 44,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.softFill,
    paddingHorizontal: 12,
    color: theme.colors.ink,
    ...theme.type.body,
    marginRight: 12,
  },
  rhythmAddRow: { marginTop: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  rhythmAddInput: {
    flex: 1,
    height: 46,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.softFill,
    paddingHorizontal: 12,
    color: theme.colors.ink,
    ...theme.type.body,
  },
  rhythmAddBtn: { paddingVertical: 12, paddingHorizontal: 14 },
  rhythmEditActions: { marginTop: 16, gap: 12 },
  rhythmEditActionsRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  rhythmActionBtn: { flex: 1, marginTop: 0 },
  rhythmSaveBtn: { marginTop: 0 },

  rhythmMicrocopy: { marginTop: 10, fontSize: 13, color: theme.colors.ink3, ...theme.type.body },

  // Confetti
  confettiWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
});