import { getSetCookie } from "@better-auth/expo/client"
import { Redirect, router, useLocalSearchParams } from "expo-router"
import * as SecureStore from "expo-secure-store"
import { Spinner } from "heroui-native/spinner"
import { useEffect, useRef, useState } from "react"
import { View } from "react-native"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { authClient } from "@/lib/auth-client"
import { consumePendingInviteCode } from "@/lib/invites"

// Mirrors the expo plugin's internal storage key: `${storagePrefix}_cookie`
// with the "lor" prefix configured in auth-client.ts.
const COOKIE_STORAGE_KEY = "lor_cookie"
const HANDOFF_TIMEOUT_MS = 5000

export default function VerifyEmailScreen() {
  const { cookie } = useLocalSearchParams<{ cookie?: string }>()
  const { data: session } = authClient.useSession()
  const [isWaiting, setIsWaiting] = useState(Boolean(cookie))
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The verification link redirects here with the session cookie as a query
  // param (attached by the better-auth expo server plugin). The client plugin
  // only extracts it during OAuth browser sessions, so store it manually the
  // same way the plugin does, then poke the session store to refetch.
  useEffect(() => {
    if (!cookie) return
    const previous = SecureStore.getItem(COOKIE_STORAGE_KEY) ?? undefined
    SecureStore.setItem(COOKIE_STORAGE_KEY, getSetCookie(cookie, previous))
    authClient.$store.notify("$sessionSignal")
    timeoutRef.current = setTimeout(
      () => setIsWaiting(false),
      HANDOFF_TIMEOUT_MS
    )
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [cookie])

  if (session) {
    const pendingInviteCode = consumePendingInviteCode()
    if (pendingInviteCode) {
      return (
        <Redirect
          href={{
            pathname: "/invite/[code]",
            params: { code: pendingInviteCode },
          }}
        />
      )
    }
    return <Redirect href="/" />
  }

  if (isWaiting) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Signing you in" />
        </View>
      </Screen>
    )
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <StatePanel
        action={{
          label: "Sign in",
          onPress: () => router.replace("/sign-in"),
        }}
        className="flex-1"
        detail="Your email is verified. Sign in to continue."
        title="Email verified"
      />
    </Screen>
  )
}
