import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useFonts, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { Fraunces_600SemiBold, Fraunces_700Bold } from "@expo-google-fonts/fraunces";

import HomebaseScreen from "./src/screens/HomebaseScreen";
import BrainDumpScreen from "./src/screens/BrainDumpScreen";
import ReviewScreen from "./src/screens/ReviewScreen";
import OnDeckScreen from "./src/screens/OnDeckScreen";
import LaterScreen from "./src/screens/LaterScreen";

import CookingModeScreen from "./src/screens/CookingModeScreen";
import RecipesScreen from "./src/screens/RecipesScreen";
import AddRecipeLinkScreen from "./src/screens/AddRecipeLinkScreen";
import RecipeLinkScreen from "./src/screens/RecipeLinkScreen";
import ArchiveScreen from "./src/screens/ArchiveScreen";

export type BrainCategory =
  | "Errands"
  | "Calls"
  | "Groceries"
  | "Home"
  | "Kids"
  | "Meals"
  | "Admin"
  | "Ideas"
  | "Someday";

export type WhenBucket = "Today" | "Later";

export type DraftTask = {
  id: string;
  title: string;
  category: BrainCategory;
  bucket: WhenBucket;
  dueDateKey?: string; // YYYY-MM-DD (local)
  urgency?: "low" | "normal" | "urgent";
};

export type Task = {
  id: number;
  title: string;
  done: boolean;
  category?: BrainCategory;
  dueDateKey?: string; // YYYY-MM-DD (local)
  plan?: "today" | "upnext"; // NEW: focus vs just active
  urgency?: "low" | "normal" | "urgent";
};

export type ArchivedTask = {
  id: string;              // unique archive id
  title: string;
  category?: BrainCategory; // keep if you have it
  completedDateKey: string; // YYYY-MM-DD (local)
};

export type StructuredRecipe = {
  kind: "structured";
  id: string;
  title: string;
  servings?: string;
  ingredients: string[];
  steps: string[];
  favorite?: boolean;
};

export type LinkRecipe = {
  kind: "link";
  id: string;
  title: string;
  url: string;
  favorite?: boolean;
};

export type RecipeItem = StructuredRecipe | LinkRecipe;

export type RootStackParamList = {
  Home: undefined;
  BrainDump: undefined;
  Review: { drafts: DraftTask[] };

  OnDeck: { tasks: Task[]; onUpdate: (tasks: Task[]) => void };
  Later: undefined;

  Archive: undefined;

  Cooking: { recipe: StructuredRecipe };
  RecipeLink: { recipe: LinkRecipe };

  Recipes: {
    selectedId?: string | null;
    defaultFilter?: "saved" | "links";
    onSelect: (recipe: RecipeItem) => void;
  };

  AddRecipeLink: { onCreate: (recipe: LinkRecipe) => void };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
  });

  if (!fontsLoaded) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomebaseScreen} options={{ title: "Homebase" }} />
        <Stack.Screen name="BrainDump" component={BrainDumpScreen} options={{ title: "Brain Dump" }} />
        <Stack.Screen name="Review" component={ReviewScreen} options={{ title: "Review First" }} />
        <Stack.Screen name="OnDeck" component={OnDeckScreen} options={{ title: "On Deck" }} />
        <Stack.Screen name="Later" component={LaterScreen} options={{ title: "Later" }} />
        <Stack.Screen name="Archive" component={ArchiveScreen} />
        <Stack.Screen name="Cooking" component={CookingModeScreen} options={{ title: "Cooking Mode" }} />
        <Stack.Screen name="RecipeLink" component={RecipeLinkScreen} options={{ title: "Recipe" }} />
        <Stack.Screen name="Recipes" component={RecipesScreen} options={{ title: "Recipes" }} />
        <Stack.Screen name="AddRecipeLink" component={AddRecipeLinkScreen} options={{ title: "Paste Recipe Link" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}