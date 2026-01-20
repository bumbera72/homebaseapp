import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  ScrollView,
  Pressable,
  StyleSheet,
  TextInput,
  Platform,
  NativeModules,
  useWindowDimensions,
  Keyboard,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  Linking,
  findNodeHandle,
} from "react-native";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { createClient, Session } from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
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

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

// In‑App Purchase product IDs (must match App Store Connect)
const IAP_PRODUCT_IDS = ["homebase.monthly", "homebase.yearly"] as const;

// Policy links shown in-app
const PRIVACY_URL = "https://thehomebaseapp.com/privacy-policy";
const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const DELETE_ACCOUNT_URL = "https://thehomebaseapp.com/delete-account";

// Paywall timing: let users experience Homebase before prompting to subscribe
const HB_PAYWALL_OPENS_KEY = "homebase:paywall:opens:v1";
const HB_PAYWALL_MIN_OPENS = 3;

// App Review override: set EXPO_PUBLIC_REVIEW_MODE=1 in your EAS build env to show the paywall immediately.
const HB_REVIEW_MODE = process.env.EXPO_PUBLIC_REVIEW_MODE === "1";
const HB_PAYWALL_MIN_OPENS_EFFECTIVE = HB_REVIEW_MODE ? 1 : HB_PAYWALL_MIN_OPENS;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// react-native-iap is a native module and will crash in Expo Go (NitroModules not supported).
// We load it dynamically only in dev builds / TestFlight where native modules exist.
function getIapModule(): any | null {
  try {
    // Expo Go / Store client
    if (Constants.appOwnership === "expo") return null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("react-native-iap");
  } catch {
    return null;
  }
}
// Dev helper to unblock App Store screenshots.
// IMPORTANT: the manual override should work even if __DEV__ is unexpectedly false.
const SCREENSHOT_MODE =
  process.env.EXPO_PUBLIC_SCREENSHOT_MODE === "1" ||
  (__DEV__ &&
    Platform.OS === "ios" &&
    (
      // Expo Go / Store client
      Constants.appOwnership === "expo" ||
      // iOS Simulator
      Device.isDevice === false
    ));

    

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

function greetingWithName(firstName?: string, now: Date = new Date()) {
  const hour = now.getHours();
  const g = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const namePart = firstName ? `, ${firstName}` : "";
  return `${g}${namePart} ${seasonalEmoji(now)}`;
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

  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Email/Password auth (for App Review + non-Apple sign in)
const [authMode, setAuthMode] = useState<"apple" | "email">("apple");
const [authIsSignUp, setAuthIsSignUp] = useState(false);
const [authEmail, setAuthEmail] = useState("");
const [authPassword, setAuthPassword] = useState("");
const [authBusy, setAuthBusy] = useState(false);
const [authError, setAuthError] = useState<string | null>(null);

  // Subscription (IAP) gate
  const [iapLoading, setIapLoading] = useState(false);
  const [entitled, setEntitled] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [subscriptionProducts, setSubscriptionProducts] = useState<any[]>([]);
  const [shouldShowPaywall, setShouldShowPaywall] = useState(false);
  const [iapDebug, setIapDebug] = useState<string>("");

    // Native iOS SubscriptionStoreView wrapper (presented from RN)
  const { SubscriptionPaywallModule } = NativeModules as any;

  // Legacy wrapper kept for older call sites.
  // IMPORTANT: Do not initiate purchases from React Native. Use Apple’s native SubscriptionStoreView.
  function openSubscriptionStoreView(_fallbackProductId?: string) {
    const hasNative = Platform.OS === "ios" && !!SubscriptionPaywallModule?.present;

    if (!hasNative) {
      Alert.alert(
        "Subscriptions unavailable",
        "The subscription screen is not available in this build. Please update the app and try again."
      );
      return;
    }

    try {
      SubscriptionPaywallModule.present();
    } catch (e: any) {
      console.log("HB native paywall present() error:", e);
      Alert.alert("Subscriptions unavailable", "Unable to open the subscription screen.");
    }
  }

// Treat the user as entitled until we intentionally show the paywall
const effectiveEntitled =
  SCREENSHOT_MODE ? true : entitled || !shouldShowPaywall;

  const scrollRef = useRef<ScrollView>(null);
  function scrollAuthFieldIntoView(fieldRef: React.RefObject<TextInput>) {
  const node = fieldRef.current ? findNodeHandle(fieldRef.current) : null;
  if (!node) return;

  const responder: any = (scrollRef.current as any)?.getScrollResponder?.();
  const fn = responder?.scrollResponderScrollNativeHandleToKeyboard;
  if (typeof fn === "function") fn(node, 120, true);
}
  const [tasksCardY, setTasksCardY] = useState<number>(0);

  // Quick Review is nested inside Brain Dump card, so we need Brain Dump's Y too.
  const [brainDumpCardY, setBrainDumpCardY] = useState<number>(0);
  const brainDumpCardYRef = useRef<number>(0);

  // Shopping card Y (for keyboard-safe auto-scroll)
  const [shoppingCardY, setShoppingCardY] = useState<number>(0);
  const shoppingCardYRef = useRef<number>(0);

  // Keyboard height (so bottom padding expands and nothing is trapped under the keyboard)
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);

  const [quickReviewY, setQuickReviewY] = useState<number>(0);
  const [pendingScrollToReview, setPendingScrollToReview] = useState(false);

  // Screenshot-only date override (for App Store screenshots). Real users always use the real date.
  const NOW = SCREENSHOT_MODE ? new Date("2024-04-16T14:00:00") : new Date();

  const todayLabel = NOW.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const todayKey = useMemo(() => todayKeyLocal(NOW), [SCREENSHOT_MODE]);

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
  const [storageLoadError, setStorageLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (SCREENSHOT_MODE) {
      // Pretend we're signed in so the dashboard renders for screenshots.
      setSession({ user: { id: "screenshot" } } as any);
      setAuthLoading(false);
      return;
    }
    let mounted = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (mounted) setSession(data.session ?? null);
      } finally {
        if (mounted) setAuthLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Delay paywall until the user has opened Homebase a few times
useEffect(() => {
  if (SCREENSHOT_MODE) {
    setShouldShowPaywall(false);
    return;
  }
  if (!session) {
    setShouldShowPaywall(false);
    return;
  }

    if (HB_REVIEW_MODE) {
    // In App Review we want the paywall to show immediately so reviewers can test purchases.
    setShouldShowPaywall(true);
    return;
  }

  let alive = true;
  (async () => {
    try {
      const raw = await AsyncStorage.getItem(HB_PAYWALL_OPENS_KEY);
      const current = raw ? Number(raw) : 0;
      const next = Number.isFinite(current) ? current + 1 : 1;

      await AsyncStorage.setItem(HB_PAYWALL_OPENS_KEY, String(next));
      if (!alive) return;

      setShouldShowPaywall(next >= HB_PAYWALL_MIN_OPENS_EFFECTIVE);
    } catch {
      if (!alive) return;
      setShouldShowPaywall(false);
    }
  })();

  return () => {
    alive = false;
  };
}, [session]);

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
    let cancelled = false;

    (async () => {
      try {
        setStorageLoadError(null);

        // Fail-safe: if AsyncStorage hangs or the device is slow, don’t block the UI forever.
        await Promise.race([
          loadFromStorage(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("storage_load_timeout")), 8000)
          ),
        ]);
      } catch (e: any) {
        if (cancelled) return;
        const msg = String(e?.message ?? e ?? "storage_load_failed");
        setStorageLoadError(msg);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep ScrollView padding in sync with the on-screen keyboard so inputs/buttons are never covered.
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvt as any, (e: any) => {
      const h = e?.endCoordinates?.height ?? 0;
      setKeyboardHeight(h);
    });

    const hideSub = Keyboard.addListener(hideEvt as any, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
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
    Keyboard.dismiss();

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
    setPendingScrollToReview(true);
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
    Keyboard.dismiss();
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

    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, tasksCardY - 12), animated: true });
    }, 120);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }
  useEffect(() => {
    if (!pendingScrollToReview) return;
    if (!reviewOpen) return;
    if (!quickReviewY) return;

    // Let layout settle before scrolling.
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, quickReviewY - 12), animated: true });
      setPendingScrollToReview(false);
    }, 120);

    return () => clearTimeout(t);
  }, [pendingScrollToReview, reviewOpen, quickReviewY]);

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
        <Text style={styles.h1}>{greetingWithName(undefined, NOW)}</Text>
        <Text style={styles.h2}>{todayLabel}</Text>
      </View>

      <View style={styles.headerRight}>
        {isLandscape ? (
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
        ) : null}

        <Pressable
          onPress={() => {
            if (session) {
              // simple V1: sign out directly
              signOut().catch(() => {});
            } else {
              signInWithApple().catch(() => {});
            }
          }}
          hitSlop={10}
          style={({ pressed }) => [styles.accountBtn, pressed && styles.pressed]}
        >
          <Text style={styles.accountBtnText}>{session ? "Sign out" : "Sign in"}</Text>
        </Pressable>
      </View>
    </View>
  );
  
  // ----- Subscription helpers (react-native-iap) -----
  async function fetchSubscriptions() {
    const IAP = getIapModule();
    if (!IAP) return [];

    // Ensure the connection is initialized before fetching products
    try {
      await IAP.initConnection?.();
    } catch {
      // ignore
    }

    // react-native-iap has had a few API shapes over versions.
    // Try multiple shapes + a getProducts fallback.
    const skus = [...IAP_PRODUCT_IDS] as any;

    // Newer versions: getSubscriptions({ skus })
    try {
      if (typeof IAP.getSubscriptions === "function") {
        const res = await IAP.getSubscriptions({ skus } as any);
        if (Array.isArray(res) && res.length) return res;
      }
    } catch {
      // fall through
    }

    // Older versions: getSubscriptions(skus)
    try {
      if (typeof IAP.getSubscriptions === "function") {
        const res = await IAP.getSubscriptions(skus);
        if (Array.isArray(res) && res.length) return res;
      }
    } catch {
      // fall through
    }

    // Fallback: some versions expose subscriptions via getProducts
    try {
      if (typeof IAP.getProducts === "function") {
        const res = await IAP.getProducts({ skus } as any);
        if (Array.isArray(res) && res.length) return res;
      }
    } catch {
      // ignore
    }

    return [];
  }

  async function requestSubscriptionCompat(productId: string) {
    const IAP = getIapModule();
    if (!IAP) {
      throw new Error(
        "Subscriptions require a TestFlight/dev build (Expo Go can’t process purchases)."
      );
    }

    // Make sure the native connection is ready (button taps can happen before the effect finishes)
    try {
      await IAP.initConnection?.();
    } catch {
      // ignore
    }

    // iOS: rn-iap often expects the iOS flag to be present on purchase requests.
    // (If the lib doesn't recognize the key, it will be ignored.)
    const iosOpts = { andDangerouslyFinishTransactionAutomaticallyIOS: false } as any;

    // Prefer requestSubscription if available.
    if (typeof IAP.requestSubscription === "function") {
      // react-native-iap has changed request shapes across versions.
      // Try the most common shapes in order.

      // Shape A: flat object { sku, ... }
      const reqA = { sku: productId, ...iosOpts } as any;

      // Shape B (newer convention): platform-nested object
      const reqB = {
        ios: { sku: productId, ...iosOpts },
        android: { sku: productId },
      } as any;

      try {
        return await IAP.requestSubscription(reqA);
      } catch (eA: any) {
        try {
          return await IAP.requestSubscription(reqB);
        } catch (eB: any) {
          // Shape C: string sku for older versions
          return await IAP.requestSubscription(productId as any);
        }
      }
    }

    // Fallback: requestPurchase is used for subscriptions in some older versions.
    if (typeof IAP.requestPurchase === "function") {
      const reqA = { sku: productId, ...iosOpts } as any;
      const reqB = { ios: { sku: productId, ...iosOpts }, android: { sku: productId } } as any;
      try {
        return await IAP.requestPurchase(reqA);
      } catch {
        try {
          return await IAP.requestPurchase(reqB);
        } catch {
          return await IAP.requestPurchase(productId as any);
        }
      }
    }

    throw new Error("In-app purchase module not available.");
  }

  async function refreshEntitlement() {
    const IAP = getIapModule();
    if (!IAP) {
      // In Expo Go we can still show the paywall UI, but we cannot check real purchases.
      setEntitled(false);
      return;
    }

    try {
      // Some versions require initConnection before queries.
      try {
        await IAP.initConnection?.();
      } catch {}

      const purchases = await IAP.getAvailablePurchases();
      const has = purchases?.some?.((p: any) => IAP_PRODUCT_IDS.includes(p.productId as any)) ?? false;
      setEntitled(!!has);
    } catch {
      setEntitled(false);
    }
  }

  function openNativeSubscriptionPaywall() {
  const { SubscriptionPaywallModule } = NativeModules as any;
  const hasNative = Platform.OS === "ios" && !!SubscriptionPaywallModule?.present;

  if (!hasNative) {
    Alert.alert(
      "Subscriptions unavailable",
      "The subscription screen is not available in this build. Please update the app and try again."
    );
    return;
  }

  try {
    SubscriptionPaywallModule.present();
  } catch (e: any) {
    console.log("HB native paywall present() error:", e);
    Alert.alert("Subscriptions unavailable", "Unable to open the subscription screen.");
  }
}

  async function startSubscription(productId: string) {
    setBillingError(null);

    // IMPORTANT (App Store): On iOS we do not initiate purchases from React Native.
    // Always route to Apple’s native SubscriptionStoreView paywall.
    if (Platform.OS === "ios") {
      openNativeSubscriptionPaywall();
      return;
    }

    try {
      setIapLoading(true);
      const IAP = getIapModule();
      try {
        await IAP?.initConnection?.();
      } catch {}

      // Ensure we have product metadata loaded (helps prevent iOS "Missing purchase request configuration")
      if (subscriptionProducts.length === 0) {
        const subs = await fetchSubscriptions();
        setSubscriptionProducts(subs);

        const ids = Array.isArray(subs)
  ? subs.map((s: any) => s?.productId ?? s?.sku ?? s?.productID ?? "?").slice(0, 4)
  : [];

setIapDebug(
  `ownership=${Constants.appOwnership} subs=${Array.isArray(subs) ? subs.length : 0} ids=${ids.join(",")}`
);

        console.log("HB IAP subs:", Array.isArray(subs) ? subs.length : subs, subs);

        if (!subs || subs.length === 0) {
          // Don’t block purchase attempts just because product metadata didn’t load.
          // In App Review / sandbox, product fetching can be flaky, but the purchase sheet may still work.
          setSubscriptionProducts([]);
        }
      }

      // Attempt purchase even if product metadata is empty; surface any StoreKit error to the reviewer.
      await requestSubscriptionCompat(productId);
    } catch (e: any) {
      const code = String(e?.code ?? "");
      const msg = String(e?.message ?? "Could not start subscription.");
      const full = code ? `${msg} (code: ${code})` : msg;
      if (code.includes("CANCEL") || msg.toLowerCase().includes("cancel")) return;
      setBillingError(full);
      if (HB_REVIEW_MODE) {
        setIapDebug((prev) => (prev ? `${prev} | lastErr=${full}` : `lastErr=${full}`));
      }
    } finally {
      setIapLoading(false);
    }
  }

  async function restorePurchases() {
    setBillingError(null);
    try {
      setIapLoading(true);
      await refreshEntitlement();
      setTimeout(() => {
        setEntitled((prev) => {
          if (!prev) setBillingError("No active subscription found for this Apple ID.");
          return prev;
        });
      }, 50);
    } finally {
      setIapLoading(false);
    }
  }

  useEffect(() => {
    if (SCREENSHOT_MODE) {
      // Don’t block App Store screenshots behind billing.
      setEntitled(true);
      return;
    }

      // Don’t initialize billing until we intend to show the paywall
  if (!shouldShowPaywall) {
    return;
  }

    const IAP = getIapModule();
    if (!IAP) {
      // Expo Go: app should still run; paywall can show, but purchases won’t.
      setEntitled(false);
      return;
    }

    let purchaseSub: any;
    let errorSub: any;
    let cancelled = false;

    (async () => {
      try {
        setIapLoading(true);
        const ok = await IAP.initConnection();
        if (!ok) throw new Error("Billing unavailable");
        if (cancelled) return;

        const subs = await fetchSubscriptions();
        setSubscriptionProducts(subs);

        await refreshEntitlement();

        purchaseSub = IAP.purchaseUpdatedListener(async (purchase: any) => {
          try {
            await IAP.finishTransaction({ purchase, isConsumable: false });
          } catch {}
          await refreshEntitlement();
        });

        errorSub = IAP.purchaseErrorListener((err: any) => {
          setBillingError(err?.message ?? "Purchase failed");
        });
      } catch (e: any) {
        setBillingError(e?.message ?? "Billing error");
      } finally {
        setIapLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try { purchaseSub?.remove?.(); } catch {}
      try { errorSub?.remove?.(); } catch {}
      try { IAP.endConnection(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShowPaywall]);

  // Never render a blank screen: while auth is initializing, show a lightweight loader.
  // IMPORTANT: this must be after all hooks so hook order never changes between renders.
  if (authLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.bg,
          padding: 24,
        }}
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // After sign-in, we hydrate from AsyncStorage. If hydration is slow or fails,
  // show a friendly loader with a continue/retry path so users never get stuck.
  if (session && !loaded) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.bg,
          padding: 24,
        }}
      >
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 14, color: theme.colors.ink2, textAlign: "center" }}>
          Setting up your Homebase…
        </Text>
        {storageLoadError ? (
          <Text style={{ marginTop: 10, color: theme.colors.ink3, textAlign: "center" }}>
            {"Taking longer than expected. You can continue now — we’ll load the rest in the background."}
          </Text>
        ) : null}

        {storageLoadError ? (
          <View style={{ width: "100%", marginTop: 16 }}>
            <Pressable
              onPress={() => {
                // Allow UI through using safe defaults already in state.
                setLoaded(true);
              }}
              style={({ pressed }) => [
                styles.primaryBtn,
                { width: "100%" },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                // Retry hydration once.
                setLoaded(false);
                setTimeout(() => {
                  (async () => {
                    try {
                      setStorageLoadError(null);
                      await Promise.race([
                        loadFromStorage(),
                        new Promise((_, reject) =>
                          setTimeout(() => reject(new Error("storage_load_timeout")), 8000)
                        ),
                      ]);
                    } catch (e: any) {
                      const msg = String(e?.message ?? e ?? "storage_load_failed");
                      setStorageLoadError(msg);
                    } finally {
                      setLoaded(true);
                    }
                  })();
                }, 50);
              }}
              style={({ pressed }) => [
                styles.secondaryBtn,
                { width: "100%", marginTop: 10 },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.secondaryBtnText}>Retry loading</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  // ----- Auth helpers -----
  function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function signInWithEmailPassword() {
  const email = normalizeEmail(authEmail);
  const password = authPassword.trim();

  if (!email || !password) {
    setAuthError("Please enter your email and password.");
    return;
  }

  try {
    setAuthBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  } catch (e: any) {
    const rawMsg = String(e?.message ?? "Couldn’t sign in.");
    const msgLower = rawMsg.toLowerCase();

    // Supabase often returns this generic error when the email isn’t confirmed yet.
    // Provide a clearer next step.
    if (msgLower.includes("invalid login credentials")) {
      const friendly =
        "Invalid login credentials. If you just created this account, you may need to confirm your email first. Tap ‘Resend confirmation’ or check your inbox.";
      setAuthError(friendly);
      Alert.alert("Sign in failed", friendly);
      return;
    }

    setAuthError(rawMsg);
    Alert.alert("Sign in failed", rawMsg);
  } finally {
    setAuthBusy(false);
  }
}

async function signUpWithEmailPassword() {
  const email = normalizeEmail(authEmail);
  const password = authPassword.trim();

  if (!email || !password) {
    setAuthError("Please enter your email and password.");
    return;
  }

  if (password.length < 6) {
    setAuthError("Password must be at least 6 characters.");
    return;
  }

  try {
    setAuthBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;

    Alert.alert(
      "Account created",
      "You can sign in now. If you’re asked to confirm your email, check your inbox."
    );
    setAuthIsSignUp(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  } catch (e: any) {
    const msg = e?.message ?? "Couldn’t create account.";
    setAuthError(msg);
    Alert.alert("Sign up failed", msg);
  } finally {
    setAuthBusy(false);
  }
}
async function resendConfirmationEmail() {
  const email = normalizeEmail(authEmail);
  if (!email) {
    setAuthError("Enter your email so we can resend the confirmation.");
    return;
  }

  try {
    setAuthBusy(true);
    setAuthError(null);
    // Supabase will resend the signup confirmation email if confirmations are enabled.
    // If confirmations are disabled, this will be a no-op or return an informative error.
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) throw error;
    Alert.alert("Email sent", "Check your inbox for the confirmation email, then come back and sign in.");
  } catch (e: any) {
    const msg = e?.message ?? "Couldn’t resend confirmation email.";
    setAuthError(msg);
    Alert.alert("Resend failed", msg);
  } finally {
    setAuthBusy(false);
  }
}

async function sendPasswordReset() {
  const email = normalizeEmail(authEmail);
  if (!email) {
    setAuthError("Enter your email so we can send a reset link.");
    return;
  }

  try {
    setAuthBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
    Alert.alert("Reset email sent", "Check your inbox for a password reset link.");
  } catch (e: any) {
    const msg = e?.message ?? "Couldn’t send reset email.";
    setAuthError(msg);
    Alert.alert("Reset failed", msg);
  } finally {
    setAuthBusy(false);
  }
}
  async function signInWithApple() {
    try {
      const available = await AppleAuthentication.isAvailableAsync();
      if (!available) {
        alert("Sign in with Apple is only available on Apple devices.");
        return;
      }

      // Supabase expects a SHA256 nonce for Apple ID token sign-in.
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
        { encoding: Crypto.CryptoEncoding.HEX }
      );

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      const identityToken = credential.identityToken;
      if (!identityToken) {
        alert("Apple sign-in failed: missing identity token.");
        return;
      }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: identityToken,
        nonce: rawNonce,
      });

      if (error) {
        alert(error.message);
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      // User cancel is common
      if (e?.code === "ERR_CANCELED" || e?.code === "ERR_CANCELLED") return;
      alert(e?.message ?? "Sign in failed.");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    Haptics.selectionAsync().catch(() => {});
  }

  const BrainDumpCard = (
    <View
    style={styles.card}
    onLayout={(e) => {
      const y = e.nativeEvent.layout.y;
      setBrainDumpCardY(y);
      brainDumpCardYRef.current = y;
    }}
  >
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
        onFocus={() => {
          // Bring the Brain Dump card up so the Sort & Review / Clear buttons stay visible.
          setTimeout(() => {
            scrollRef.current?.scrollTo({ y: Math.max(0, brainDumpCardYRef.current - 16), animated: true });
          }, 50);
        }}
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
        <View
  style={styles.reviewCard}
  onLayout={(e) => {
    const absoluteY = brainDumpCardYRef.current + e.nativeEvent.layout.y;
    setQuickReviewY(absoluteY);
  }}
>
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
    <View
      style={styles.card}
      onLayout={(e) => {
        const y = e.nativeEvent.layout.y;
        setShoppingCardY(y);
        shoppingCardYRef.current = y;
      }}
    >
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
          onFocus={() => {
            // Bring the Shopping List card above the keyboard.
            setTimeout(() => {
              scrollRef.current?.scrollTo({ y: Math.max(0, shoppingCardYRef.current - 16), animated: true });
            }, 50);
          }}
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
    <View style={styles.card} onLayout={(e) => setTasksCardY(e.nativeEvent.layout.y)}>
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
                    style={({ pressed }) => [styles.primaryBtn, { marginTop: 12 }, pressed && { opacity: 0.85 }]}
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
  <KeyboardAvoidingView
    style={styles.screen}
    behavior={Platform.OS === "ios" ? "padding" : undefined}
    keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
  >
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: 80 + keyboardHeight, flexGrow: 1 },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
    >
        {authLoading && !SCREENSHOT_MODE ? (
  <View style={styles.authPage}>
    <ActivityIndicator />
  </View>
) : !session && !SCREENSHOT_MODE ? (
  <View style={styles.welcomeWrap}>
  <View style={styles.welcomeHero}>
  <Image
    source={require("../../assets/login-hero.jpg")}
    style={styles.welcomeHeroImage}
    resizeMode="cover"
    accessible
    accessibilityLabel="Homebase"
  />
</View>

  <View style={styles.welcomeContent}>
    <Text style={styles.welcomeTitle}>Welcome to Homebase</Text>
    <Text style={styles.welcomeSubtitle}>A calm place for everything your mind is holding.</Text>
    <Text style={styles.welcomeHelper}>
      Sign in to save your Homebase and keep it synced across iPhone and iPad.
    </Text>

    {authError ? <Text style={styles.welcomeError}>{authError}</Text> : null}

    <Pressable
      onPress={() => {
        setAuthMode("apple");
        signInWithApple().catch(() => {});
      }}
      disabled={authBusy}
      style={({ pressed }) => [
        styles.welcomePrimaryBtn,
        pressed && { opacity: 0.9 },
        authBusy && { opacity: 0.6 },
      ]}
    >
      <Text style={styles.welcomePrimaryBtnText}>
        {authBusy && authMode === "apple" ? "Signing in…" : "Continue with Apple"}
      </Text>
    </Pressable>

    <View style={styles.welcomeDividerRow}>
      <View style={styles.welcomeDivider} />
      <Text style={styles.welcomeDividerText}>or</Text>
      <View style={styles.welcomeDivider} />
    </View>

    <Pressable
      onPress={() => {
        setAuthMode("email");
        setAuthError(null);
      }}
      style={({ pressed }) => [styles.welcomeSecondaryBtn, pressed && { opacity: 0.9 }]}
    >
      <Text style={styles.welcomeSecondaryBtnText}>Continue with Email</Text>
    </Pressable>

    {authMode === "email" ? (
      <View style={{ marginTop: 14 }}>
        <TextInput
          value={authEmail}
          onChangeText={setAuthEmail}
          placeholder="Email"
          placeholderTextColor={theme.colors.ink3}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.welcomeInput}
        />
        <TextInput
          value={authPassword}
          onChangeText={setAuthPassword}
          placeholder="Password"
          placeholderTextColor={theme.colors.ink3}
          secureTextEntry
          style={styles.welcomeInput}
        />

        <Pressable
          onPress={() => {
            setAuthError(null);
            if (authIsSignUp) signUpWithEmailPassword().catch(() => {});
            else signInWithEmailPassword().catch(() => {});
          }}
          disabled={authBusy || !authEmail.trim() || !authPassword}
          style={({ pressed }) => [
            styles.welcomePrimaryBtn,
            { marginTop: 10 },
            (authBusy || !authEmail.trim() || !authPassword) && { opacity: 0.6 },
            pressed && { opacity: 0.9 },
          ]}
        >
          <Text style={styles.welcomePrimaryBtnText}>
            {authBusy ? "Please wait…" : authIsSignUp ? "Create account" : "Sign in"}
          </Text>
        </Pressable>

        <View style={styles.welcomeLinksRow}>
          <Pressable onPress={() => setAuthIsSignUp((p) => !p)}>
            <Text style={styles.welcomeLink}>
              {authIsSignUp ? "Already have an account? Sign in" : "Create an account"}
            </Text>
          </Pressable>

          <Pressable onPress={() => sendPasswordReset().catch(() => {})}>
            <Text style={styles.welcomeLink}>Forgot password?</Text>
          </Pressable>

          <Pressable onPress={() => resendConfirmationEmail().catch(() => {})}>
            <Text style={styles.welcomeLink}>Resend confirmation</Text>
          </Pressable>
        </View>
      </View>
    ) : null}

    <View style={styles.welcomeLegalRow}>
  <Pressable onPress={() => Linking.openURL(TERMS_URL).catch(() => {})}>
    <Text style={styles.welcomeLegalLink}>Terms</Text>
  </Pressable>
  <Text style={styles.welcomeLegalDot}>•</Text>
  <Pressable onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}>
    <Text style={styles.welcomeLegalLink}>Privacy</Text>
  </Pressable>
  <Text style={styles.welcomeLegalDot}>•</Text>
  <Pressable onPress={() => Linking.openURL(DELETE_ACCOUNT_URL).catch(() => {})}>
    <Text style={styles.welcomeLegalLink}>Delete account</Text>
  </Pressable>
</View>
  </View>
</View>
) : session && !effectiveEntitled && !SCREENSHOT_MODE ? (
  <View style={styles.authPage}>
    <View style={styles.paywallCard}>
      <View style={styles.cardTitleRow}>
        <View style={[styles.cardAccent, { backgroundColor: theme.colors.sage }]} />
        <Text style={styles.authTitle}>Homebase</Text>
      </View>

      <Text style={styles.paywallSubtitle}>Unlock full access</Text>
      <Text style={styles.paywallBody}>
        Continue to Apple’s secure subscription screen to subscribe or manage your plan.
      </Text>

      <Pressable
        onPress={openNativeSubscriptionPaywall}
        hitSlop={12}
        style={({ pressed }) => [
          styles.primaryBtn,
          styles.paywallBtn,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.primaryBtnText}>Continue</Text>
      </Pressable>

      {billingError ? <Text style={styles.paywallError}>{billingError}</Text> : null}

      <Pressable
        onPress={restorePurchases}
        hitSlop={10}
        style={({ pressed }) => [
          styles.viewAllBtn,
          { alignSelf: "center", marginTop: 10 },
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.viewAllText}>Restore Purchases</Text>
      </Pressable>

      <Pressable
        onPress={() => Linking.openURL("https://apps.apple.com/account/subscriptions").catch(() => {})}
        hitSlop={10}
        style={({ pressed }) => [
          styles.viewAllBtn,
          { alignSelf: "center", marginTop: 6 },
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.viewAllText}>Manage Subscriptions</Text>
      </Pressable>

      <View style={styles.paywallLinksRow}>
        <Pressable
          onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}
          hitSlop={10}
          style={({ pressed }) => pressed && { opacity: 0.75 }}
        >
          <Text style={styles.paywallLink}>Privacy</Text>
        </Pressable>

        <Text style={styles.paywallDot}>•</Text>

        <Pressable
          onPress={() => Linking.openURL(DELETE_ACCOUNT_URL).catch(() => {})}
          hitSlop={10}
          style={({ pressed }) => pressed && { opacity: 0.75 }}
        >
          <Text style={styles.paywallLink}>Delete account</Text>
        </Pressable>

        <Text style={styles.paywallDot}>•</Text>

        <Pressable
          onPress={() => Linking.openURL(TERMS_URL).catch(() => {})}
          hitSlop={10}
          style={({ pressed }) => pressed && { opacity: 0.75 }}
        >
          <Text style={styles.paywallLink}>Terms</Text>
        </Pressable>
      </View>
    </View>
  </View>
) : null}
        {((session && effectiveEntitled) || SCREENSHOT_MODE) ? Header : null}

        {/* Debug info removed */}
        {((session && effectiveEntitled) || SCREENSHOT_MODE) ? (
          isLandscape ? (
            <View style={styles.landscapeRow}>
              <View style={styles.leftColumn}>
                <TodayScheduleCard
                  titleFontFamily={theme.type.h1.fontFamily}
                  bodyFontFamily={theme.type.body.fontFamily}
                  uiFontFamily={theme.type.ui.fontFamily}
                  nowOverride={NOW}
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
                nowOverride={NOW}
              />
              {TasksCard}
              {DailyRhythmCard}
              {TonightCard}
              {BrainDumpCard}
              {ShoppingListCard}
            </>
          )
        ) : null}
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
    </KeyboardAvoidingView>
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
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
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
  accountBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  accountBtnText: { color: theme.colors.ink, ...theme.type.ui },

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

  welcomeWrap: {
  paddingHorizontal: 16,
  paddingTop: 14,
  paddingBottom: 18,
},
welcomeHero: {
  height: 190,
  borderRadius: 18,
  overflow: "hidden",
  backgroundColor: theme.colors.softFill,
  borderWidth: 1,
  borderColor: theme.colors.border,
  alignItems: "center",
  justifyContent: "center",
},

welcomeHeroImage: {
  width: "100%",
  height: "100%",
},

welcomeHeroInner: {
  flex: 1,
  backgroundColor: theme.colors.sage,
  opacity: 0.22,
},

welcomeContent: {
  marginTop: 16,
  paddingHorizontal: 2,
},
welcomeTitle: {
  fontSize: 30,
  fontWeight: "700",
  color: theme.colors.ink,
},
welcomeSubtitle: {
  marginTop: 8,
  fontSize: 16,
  lineHeight: 22,
  color: theme.colors.ink2,
},
welcomeHelper: {
  marginTop: 8,
  fontSize: 14,
  lineHeight: 20,
  color: theme.colors.ink3,
},
welcomeError: {
  marginTop: 10,
  color: "#B3261E",
},
welcomePrimaryBtn: {
  marginTop: 16,
  height: 54,
  borderRadius: 28,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.sage,
},
welcomePrimaryBtnText: {
  color: theme.colors.ink,
  fontSize: 16,
  fontWeight: "700",
},
welcomeDividerRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  marginTop: 14,
},
welcomeDivider: {
  flex: 1,
  height: 1,
  backgroundColor: theme.colors.hairline,
},
welcomeDividerText: {
  color: theme.colors.ink3,
  fontSize: 12,
},
welcomeSecondaryBtn: {
  marginTop: 14,
  height: 54,
  borderRadius: 28,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: theme.colors.card,
  borderWidth: 1,
  borderColor: theme.colors.border,
},
welcomeSecondaryBtnText: {
  color: theme.colors.ink,
  fontSize: 16,
  fontWeight: "700",
},
welcomeInput: {
  height: 52,
  borderRadius: 14,
  paddingHorizontal: 14,
  borderWidth: 1,
  borderColor: theme.colors.border,
  backgroundColor: theme.colors.card,
  color: theme.colors.ink,
  marginBottom: 10,
},
welcomeLinksRow: {
  marginTop: 10,
  gap: 10,
},
welcomeLink: {
  color: theme.colors.ink2,
  textDecorationLine: "underline",
},
welcomeLegalRow: {
  flexDirection: "row",
  justifyContent: "center",
  alignItems: "center",
  gap: 10,
  marginTop: 18,
},
welcomeLegalLink: {
  color: theme.colors.ink2,
  textDecorationLine: "underline",
},
welcomeLegalDot: {
  color: theme.colors.ink3,
},

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

authPage: {
  flex: 1,
  justifyContent: "center",
  alignItems: "center",
  padding: 24,
},
authCard: {
  width: "100%",
  maxWidth: 520,
  backgroundColor: theme.colors.card,
  borderRadius: 18,
  padding: 18,
  borderWidth: 1,
  borderColor: theme.colors.border,
},
authTitle: {
  fontSize: 22,
  fontWeight: "700",
  color: theme.colors.ink,
  marginLeft: 8,
},
authSubtitle: {
  marginTop: 10,
  fontSize: 16,
  fontWeight: "600",
  color: theme.colors.ink,
},
authBody: {
  marginTop: 8,
  fontSize: 14,
  lineHeight: 20,
  color: theme.colors.ink2,
},
authTrust: {
  marginTop: 12,
  fontSize: 13,
  color: theme.colors.ink3,
  textAlign: "center",
},
  paywallCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: theme.colors.card,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  paywallSubtitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.ink,
  },
  paywallBody: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.ink2,
  },
  paywallError: {
    marginTop: 10,
    fontSize: 13,
    color: theme.colors.ink,
  },
  paywallBtn: {
    marginTop: 10,
    paddingVertical: 14,
  },
  paywallBtnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  paywallBtnMeta: {
    fontSize: 13,
    color: theme.colors.ink2,
  },
  paywallBtnNote: {
    marginTop: 6,
    fontSize: 12,
    color: theme.colors.ink3,
  },
  paywallLinksRow: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  paywallLink: {
    fontSize: 13,
    color: theme.colors.ink2,
    textDecorationLine: "underline",
  },
  paywallDot: {
    marginHorizontal: 10,
    fontSize: 13,
    color: theme.colors.ink3,
  },

  // Confetti
  confettiWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
});