import { useQuery } from "@tanstack/react-query"
import * as Application from "expo-application"
import * as Updates from "expo-updates"
import { useEffect, useRef } from "react"
import { AppState, Linking, StyleSheet, Text, View } from "react-native"
import { Button } from "@/components/ui/button"
import { Screen } from "@/components/ui/screen"
import { api } from "@/lib/api"

// A return to the app after this long applies a downloaded update; a quick
// switch to another app and back keeps the user's place.
const RELOAD_AFTER_BACKGROUND_MS = 60_000
const CHECK_INTERVAL_MS = 10 * 60_000

// Compares each part as a number, so "0.10.0" is newer than "0.9.3". A
// malformed version never counts as older, so a bad value can't lock anyone out.
function isOlderVersion(version: string, minimum: string) {
  const current = version.split(".").map(Number)
  const required = minimum.split(".").map(Number)
  for (let i = 0; i < Math.max(current.length, required.length); i++) {
    const difference = (current[i] ?? 0) - (required[i] ?? 0)
    if (difference !== 0) return difference < 0
  }
  return false
}

// Over-the-air updates download at launch but only run after a restart. This
// checks again on each return to the foreground and switches to a downloaded
// update when the app comes back after a while, so a release doesn't leave a
// long-lived app on old code.
function useOverTheAirUpdates() {
  const { isUpdatePending } = Updates.useUpdates()
  const backgroundedAt = useRef<number | null>(null)
  const lastCheck = useRef(Date.now())

  useEffect(() => {
    if (!Updates.isEnabled) return
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        backgroundedAt.current = Date.now()
        return
      }
      if (state !== "active") return
      const away = Date.now() - (backgroundedAt.current ?? Date.now())
      backgroundedAt.current = null
      if (isUpdatePending) {
        if (away >= RELOAD_AFTER_BACKGROUND_MS) {
          void Updates.reloadAsync().catch(() => undefined)
        }
        return
      }
      if (Date.now() - lastCheck.current < CHECK_INTERVAL_MS) return
      lastCheck.current = Date.now()
      void Updates.checkForUpdateAsync()
        .then((result) =>
          result.isAvailable ? Updates.fetchUpdateAsync() : undefined
        )
        .catch(() => undefined)
    })
    return () => subscription.remove()
  }, [isUpdatePending])
}

// Covers the app when the server no longer supports this build (a release
// that changed native code can't reach it over the air). Fails open: no
// answer from the server never blocks.
export function AppUpdates() {
  useOverTheAirUpdates()
  // The installed build's version, not the running update's: the gate is
  // about native code an update can't replace.
  const version = Application.nativeApplicationVersion
  const { data } = useQuery({
    queryKey: ["mobile-version"],
    queryFn: async () => {
      const response = await api.v1.mobile.version.$get()
      if (!response.ok) throw new Error("Couldn't check the app version")
      return response.json()
    },
  })

  const minimum = data?.minimumVersion
  if (!data || !minimum || !version || !isOlderVersion(version, minimum)) {
    return null
  }
  return (
    <View style={StyleSheet.absoluteFill}>
      <Screen
        className="items-center justify-center gap-three bg-background px-eight"
        edges={["top", "bottom"]}
      >
        <Text className="text-center text-xl font-bold text-foreground">
          Update Lor
        </Text>
        <Text className="text-center text-sm leading-5 text-muted">
          This version of Lor is too old to work. Install the latest version to
          continue.
        </Text>
        <Text className="text-center text-xs tabular-nums text-muted">
          You have {version}. Lor needs {minimum} or later.
        </Text>
        <Button
          className="mt-three"
          onPress={() => {
            void Linking.openURL(data.updateUrl).catch(() => undefined)
          }}
        >
          Get the latest version
        </Button>
      </Screen>
    </View>
  )
}
