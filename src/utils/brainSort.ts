import type { BrainCategory, DraftTask, WhenBucket } from "../../App";

const containsAny = (s: string, words: string[]) => words.some((w) => s.includes(w));

export function normalizeLine(raw: string) {
  return raw
    .replace(/^[\-\*\•\u2022]+\s*/, "")
    .replace(/^\d+[\)\.\-]\s*/, "")
    .trim();
}

export function guessBucket(title: string): WhenBucket {
  const s = title.toLowerCase();
  if (containsAny(s, ["today", "tonight", "before bed", "this morning", "asap"])) return "Today";
  if (containsAny(s, ["tomorrow"])) return "Today"; // tweak if you prefer "Later"
  return "Later";
}

export function guessCategory(title: string): BrainCategory {
  const s = title.toLowerCase();

  // groceries / shopping
  if (containsAny(s, ["grocery", "groceries", "costco", "walmart", "heb", "target", "shopping", "buy "])) return "Groceries";
  if (containsAny(s, ["milk", "eggs", "bread", "chicken", "ground beef", "produce", "snacks"])) return "Groceries";

  // calls / comms
  if (containsAny(s, ["call", "text", "email", "dm", "message", "reply"])) return "Calls";

  // errands
  if (containsAny(s, ["return", "pickup", "pick up", "drop off", "post office", "ups", "fedex", "ship", "deliver"])) return "Errands";

  // kids / school
  if (containsAny(s, ["school", "teacher", "permission slip", "field trip", "practice", "game", "uniform", "daycare", "pediatric", "dentist"])) return "Kids";

  // home chores
  if (containsAny(s, ["laundry", "dishes", "clean", "vacuum", "mop", "trash", "kitchen reset", "wipe", "organize"])) return "Home";

  // meals / dinner
  if (containsAny(s, ["dinner", "meal", "recipe", "cook", "prep", "marinate"])) return "Meals";

  // admin / money / appointments
  if (containsAny(s, ["bill", "pay", "invoice", "bank", "budget", "renew", "insurance", "appointment", "schedule"])) return "Admin";

  // ideas
  if (containsAny(s, ["idea", "maybe", "would be nice", "plan"])) return "Ideas";

  return "Someday";
}

export function sortBrainDump(text: string): DraftTask[] {
  const lines = text
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);

  return lines.map((title) => ({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    category: guessCategory(title),
    bucket: guessBucket(title),
  }));
}