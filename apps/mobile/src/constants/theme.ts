import "@/global.css"

import { Platform } from "react-native"

export const Colors = {
  light: {
    background: "#fdfcf9",
    surface: "#ffffff",
    surfaceRaised: "#ffffff",
    sidebar: "#f8f7f3",
    text: "#343230",
    textSecondary: "#7b7771",
    textTertiary: "#a7a29a",
    border: "#e9e6df",
    divider: "#f0ede7",
    accent: "#6c4abb",
    accentMuted: "#f0ebfb",
    accentForeground: "#ffffff",
    merlin: "#7c5bc7",
    merlinMuted: "#f3eefc",
    success: "#268b63",
    danger: "#c64b4b",
    pressed: "#ece8e0",
    backgroundElement: "#f8f7f3",
    backgroundSelected: "#ece8e0",
  },
  dark: {
    background: "#1d1b1e",
    surface: "#242124",
    surfaceRaised: "#2c292e",
    sidebar: "#17161a",
    text: "#f4f1ed",
    textSecondary: "#beb8b1",
    textTertiary: "#8b8580",
    border: "#39353a",
    divider: "#2f2c31",
    accent: "#a990e6",
    accentMuted: "#413758",
    accentForeground: "#251d36",
    merlin: "#b49aeb",
    merlinMuted: "#443860",
    success: "#62bb8e",
    danger: "#ec7777",
    pressed: "#343137",
    backgroundElement: "#242124",
    backgroundSelected: "#343137",
  },
} as const

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
})

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 20,
  six: 24,
  seven: 32,
  eight: 40,
} as const

export const MaxContentWidth = 800
export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0
export const Radius = {
  small: 8,
  medium: 12,
  large: 16,
  pill: 999,
} as const
