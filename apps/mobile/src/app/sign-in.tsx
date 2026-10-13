import { Redirect, router } from "expo-router"
import { useRef, useState } from "react"
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native"
import { Screen } from "@/components/ui/screen"
import { useTheme } from "@/hooks/use-theme"
import { authClient } from "@/lib/auth-client"
import { consumePendingInviteCode } from "@/lib/invites"
import lorMark from "../../assets/images/splash-icon.png"

export default function SignInScreen() {
  const theme = useTheme()
  const { data: session } = authClient.useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const pendingInviteCodeRef = useRef<string | null | undefined>(undefined)

  if (session) {
    if (pendingInviteCodeRef.current === undefined) {
      pendingInviteCodeRef.current = consumePendingInviteCode()
    }
    const pendingInviteCode = pendingInviteCodeRef.current
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

  const canSubmit =
    email.trim().length > 0 && password.length > 0 && !submitting
  const signIn = async () => {
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      })
      if (result.error) {
        // 403 = email not verified — better-auth re-sends the verification
        // email automatically on the failed attempt.
        if (result.error.status === 403) {
          router.replace({
            pathname: "/check-email",
            params: { email: email.trim() },
          })
          return
        }
        setError(result.error.message ?? "Sign in failed")
      }
    } catch {
      setError("Sign in failed. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen className="bg-lor-bg dark:bg-lor-bg-dark">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-seven">
          <Image
            source={lorMark}
            className="mb-seven"
            style={{ width: 56, height: 34 }}
          />
          <View className="mb-eight gap-two">
            <Text className="text-[28px] font-bold tracking-[-0.6px] text-lor-text dark:text-lor-text-dark">
              Welcome to Lor
            </Text>
            <Text className="text-base leading-[22px] text-lor-text-secondary dark:text-lor-text-secondary-dark">
              AI agents your whole team can steer.
            </Text>
          </View>
          <View className="gap-four">
            <View className="gap-two">
              <Text className="text-[13px] font-semibold text-lor-text-secondary dark:text-lor-text-secondary-dark">
                Email
              </Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                className="min-h-[52px] rounded-lor-md border border-lor-border bg-lor-surface px-three text-base text-lor-text dark:border-lor-border-dark dark:bg-lor-surface-dark dark:text-lor-text-dark"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="you@company.com"
                placeholderTextColor={theme.textTertiary}
                textContentType="emailAddress"
                value={email}
              />
            </View>
            <View className="gap-two">
              <Text className="text-[13px] font-semibold text-lor-text-secondary dark:text-lor-text-secondary-dark">
                Password
              </Text>
              <TextInput
                autoComplete="current-password"
                className="min-h-[52px] rounded-lor-md border border-lor-border bg-lor-surface px-three text-base text-lor-text dark:border-lor-border-dark dark:bg-lor-surface-dark dark:text-lor-text-dark"
                onChangeText={setPassword}
                onSubmitEditing={() => void signIn()}
                placeholder="Your password"
                placeholderTextColor={theme.textTertiary}
                secureTextEntry
                textContentType="password"
                value={password}
              />
            </View>
            {error ? (
              <Text className="text-[13px] leading-[18px] text-lor-danger dark:text-lor-danger-dark">
                {error}
              </Text>
            ) : null}
            <Pressable
              className={`mt-two min-h-[52px] items-center justify-center rounded-lor-md ${
                canSubmit
                  ? "bg-lor-accent active:scale-[0.985] active:opacity-85 dark:bg-lor-accent-dark"
                  : "bg-lor-divider dark:bg-lor-divider-dark"
              }`}
              disabled={!canSubmit}
              onPress={() => void signIn()}
            >
              {submitting ? (
                <ActivityIndicator color={theme.accentForeground} />
              ) : (
                <Text
                  className={
                    canSubmit
                      ? "text-base font-semibold text-lor-accent-fg dark:text-lor-accent-fg-dark"
                      : "text-base font-semibold text-lor-text-tertiary dark:text-lor-text-tertiary-dark"
                  }
                >
                  Sign in
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="min-h-11 items-center justify-center active:opacity-70"
              onPress={() => router.replace("/sign-up")}
            >
              <Text className="text-sm font-medium text-lor-text-secondary dark:text-lor-text-secondary-dark">
                Don’t have an account?{" "}
                <Text className="font-semibold text-lor-accent dark:text-lor-accent-dark">
                  Sign up
                </Text>
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}
