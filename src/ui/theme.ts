// src/ui/theme.ts
import { Platform } from "react-native";

export const theme = {
  colors: {
    bg: "#FBF7F2",
    card: "#FFFFFF",
    border: "rgba(30,20,10,0.10)",
    hairline: "rgba(30,20,10,0.08)",

    ink: "#1C1612",
    ink2: "rgba(28,22,18,0.72)",
    ink3: "rgba(28,22,18,0.55)",

    // subtle pops
    sage: "#BFD3C1",
    mist: "#BFD7EA",
    blush: "#E8C9D3",

    // surfaces
    softFill: "rgba(28,22,18,0.04)",
    softFill2: "rgba(28,22,18,0.06)",

    // ✅ buttons (consistent everywhere)
    primaryFill: "rgba(191,211,193,0.55)", // sage tint (calming, not loud)
    primaryBorder: "rgba(191,211,193,0.65)",
    primaryText: "#1C1612",

    secondaryFill: "rgba(28,22,18,0.04)",
    secondaryBorder: "rgba(30,20,10,0.14)",
    secondaryText: "#1C1612",

    dangerFill: "rgba(232,201,211,0.26)", // blush tint
    dangerBorder: "rgba(232,201,211,0.72)",
    dangerText: "#1C1612",

    // optional “ink button” for high-emphasis actions
    inkFill: "#1C1612",
    inkText: "#FFFFFF",
    
  },

  radius: {
    xl: 18,
    lg: 16,
    md: 14,
    pill: 999,
  },

  type: {
    h1: { fontFamily: "Fraunces_700Bold" as const },
    h2: { fontFamily: "Fraunces_600SemiBold" as const },

    ui: { fontFamily: "Inter_600SemiBold" as const },
    body: { fontFamily: "Inter_500Medium" as const },
    bold: { fontFamily: "Inter_700Bold" as const },
  },

  shadow: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
    android: { elevation: 3 },
    default: {},
  }),
};