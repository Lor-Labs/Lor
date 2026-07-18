import * as SecureStore from "expo-secure-store"
import { Uniwind } from "uniwind"

const THEME_PREFERENCE_KEY = "lor.theme-preference"

export type ThemePreference = "light" | "dark" | "system"

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system"
}

export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const stored = await SecureStore.getItemAsync(THEME_PREFERENCE_KEY)
    return isThemePreference(stored) ? stored : "system"
  } catch {
    return "system"
  }
}

export function applyThemePreference(preference: ThemePreference) {
  Uniwind.setTheme(preference)
}

export async function saveThemePreference(preference: ThemePreference) {
  applyThemePreference(preference)
  try {
    await SecureStore.setItemAsync(THEME_PREFERENCE_KEY, preference)
  } catch {
    // Preference still applies for this session; persistence is best-effort.
  }
}

export async function restoreThemePreference() {
  const preference = await loadThemePreference()
  if (preference !== "system") applyThemePreference(preference)
}
