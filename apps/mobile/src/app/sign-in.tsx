import { Redirect } from "expo-router"
import { useState } from "react"
import {
  ActivityIndicator,
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

export default function SignInScreen() {
  const theme = useTheme()
  const { data: session } = authClient.useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
      if (result.error) setError(result.error.message ?? "Sign in failed")
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
          <View className="mb-seven h-[52px] w-[52px] items-center justify-center rounded-lor-lg bg-lor-accent dark:bg-lor-accent-dark">
            <Text className="text-[25px] font-bold text-lor-accent-fg dark:text-lor-accent-fg-dark">
              L
            </Text>
          </View>
          <View className="mb-eight gap-two">
            <Text className="text-[28px] font-bold tracking-[-0.6px] text-lor-text dark:text-lor-text-dark">
              Welcome to Lor
            </Text>
            <Text className="text-base leading-[22px] text-lor-text-secondary dark:text-lor-text-secondary-dark">
              Your team’s shared memory, in motion.
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
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}
