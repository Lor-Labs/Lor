import { Redirect, router } from "expo-router"
import { useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native"
import { Screen } from "@/components/ui/screen"
import { useTheme } from "@/hooks/use-theme"
import { authClient } from "@/lib/auth-client"
import { consumePendingInviteCode } from "@/lib/invites"

const MIN_PASSWORD_LENGTH = 8

export default function SignUpScreen() {
  const theme = useTheme()
  const { data: session } = authClient.useSession()
  const [name, setName] = useState("")
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
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    !submitting

  const signUp = async () => {
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        // The verification email link lands on this deep link after
        // verifying, carrying the session across (expo plugin).
        callbackURL: "/verify-email",
      })
      if (result.error) {
        setError(result.error.message ?? "Could not create your account")
        return
      }
      router.replace({
        pathname: "/check-email",
        params: { email: email.trim() },
      })
    } catch {
      setError("Sign up failed. Check your connection and try again.")
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
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-seven"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-seven h-[52px] w-[52px] items-center justify-center rounded-lor-lg bg-lor-accent dark:bg-lor-accent-dark">
            <Text className="text-[25px] font-bold text-lor-accent-fg dark:text-lor-accent-fg-dark">
              L
            </Text>
          </View>
          <View className="mb-eight gap-two">
            <Text className="text-[28px] font-bold tracking-[-0.6px] text-lor-text dark:text-lor-text-dark">
              Create your account
            </Text>
            <Text className="text-base leading-[22px] text-lor-text-secondary dark:text-lor-text-secondary-dark">
              Enter your information below to get started.
            </Text>
          </View>
          <View className="gap-four">
            <View className="gap-two">
              <Text className="text-[13px] font-semibold text-lor-text-secondary dark:text-lor-text-secondary-dark">
                Display name
              </Text>
              <TextInput
                autoComplete="name"
                className="min-h-[52px] rounded-lor-md border border-lor-border bg-lor-surface px-three text-base text-lor-text dark:border-lor-border-dark dark:bg-lor-surface-dark dark:text-lor-text-dark"
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={theme.textTertiary}
                textContentType="name"
                value={name}
              />
            </View>
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
                autoComplete="new-password"
                className="min-h-[52px] rounded-lor-md border border-lor-border bg-lor-surface px-three text-base text-lor-text dark:border-lor-border-dark dark:bg-lor-surface-dark dark:text-lor-text-dark"
                onChangeText={setPassword}
                onSubmitEditing={() => void signUp()}
                placeholder="At least 8 characters"
                placeholderTextColor={theme.textTertiary}
                secureTextEntry
                textContentType="newPassword"
                value={password}
              />
              <Text className="text-xs text-lor-text-tertiary dark:text-lor-text-tertiary-dark">
                Must be at least 8 characters long.
              </Text>
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
              onPress={() => void signUp()}
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
                  Create account
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="min-h-11 items-center justify-center active:opacity-70"
              onPress={() => router.replace("/sign-in")}
            >
              <Text className="text-sm font-medium text-lor-text-secondary dark:text-lor-text-secondary-dark">
                Already have an account?{" "}
                <Text className="font-semibold text-lor-accent dark:text-lor-accent-dark">
                  Sign in
                </Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}
