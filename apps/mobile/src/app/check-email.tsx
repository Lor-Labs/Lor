import { router, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { Screen } from "@/components/ui/screen"
import { useTheme } from "@/hooks/use-theme"
import { authClient } from "@/lib/auth-client"

export default function CheckEmailScreen() {
  const theme = useTheme()
  const { email } = useLocalSearchParams<{ email?: string }>()
  const [isResending, setIsResending] = useState(false)
  const [hasResent, setHasResent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resend = async () => {
    if (!email || isResending || hasResent) return
    setIsResending(true)
    setError(null)
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/verify-email",
      })
      if (result.error) {
        setError(result.error.message ?? "Could not resend the email")
        return
      }
      setHasResent(true)
    } catch {
      setError("Could not resend the email. Check your connection.")
    } finally {
      setIsResending(false)
    }
  }

  return (
    <Screen className="bg-lor-bg dark:bg-lor-bg-dark">
      <View className="flex-1 justify-center px-seven">
        <View className="mb-seven h-[52px] w-[52px] items-center justify-center rounded-lor-lg bg-lor-accent dark:bg-lor-accent-dark">
          <SymbolView
            name={{ ios: "envelope.fill", android: "mail", web: "mail" }}
            size={24}
            tintColor={theme.accentForeground}
          />
        </View>
        <View className="mb-eight gap-two">
          <Text className="text-[28px] font-bold tracking-[-0.6px] text-lor-text dark:text-lor-text-dark">
            Check your email
          </Text>
          <Text className="text-base leading-[22px] text-lor-text-secondary dark:text-lor-text-secondary-dark">
            We sent a verification link to{" "}
            {email ? (
              <Text className="font-semibold text-lor-text dark:text-lor-text-dark">
                {email}
              </Text>
            ) : (
              "your email"
            )}
            . Open it on this device to finish signing in — or verify anywhere
            and come back to sign in.
          </Text>
        </View>
        <View className="gap-three">
          {error ? (
            <Text className="text-[13px] leading-[18px] text-lor-danger dark:text-lor-danger-dark">
              {error}
            </Text>
          ) : null}
          {email ? (
            <Pressable
              accessibilityRole="button"
              className={`min-h-[52px] items-center justify-center rounded-lor-md border border-lor-border dark:border-lor-border-dark ${
                isResending || hasResent ? "opacity-60" : "active:opacity-70"
              }`}
              disabled={isResending || hasResent}
              onPress={() => void resend()}
            >
              <Text className="text-base font-semibold text-lor-text dark:text-lor-text-dark">
                {isResending
                  ? "Sending…"
                  : hasResent
                    ? "Email sent!"
                    : "Resend verification email"}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            className="min-h-11 items-center justify-center active:opacity-70"
            onPress={() => router.replace("/sign-in")}
          >
            <Text className="text-sm font-medium text-lor-text-secondary dark:text-lor-text-secondary-dark">
              Back to sign in
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  )
}
