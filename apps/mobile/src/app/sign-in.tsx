import { Redirect } from "expo-router"
import { useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { ThemedText } from "@/components/themed-text"
import { ThemedView } from "@/components/themed-view"
import { MaxContentWidth, Spacing } from "@/constants/theme"
import { useTheme } from "@/hooks/use-theme"
import { authClient } from "@/lib/auth-client"

export default function SignInScreen() {
  const theme = useTheme()
  const { data: session } = authClient.useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (session) return <Redirect href="/" />

  const canSubmit =
    email.trim().length > 0 && password.length > 0 && !submitting

  const handleSignIn = async () => {
    setError(null)
    setSubmitting(true)
    const result = await authClient.signIn.email({
      email: email.trim(),
      password,
    })
    setSubmitting(false)
    if (result.error) {
      setError(result.error.message ?? "Sign in failed")
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.content}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ThemedText type="subtitle" style={styles.title}>
            Sign in to Lor
          </ThemedText>

          <TextInput
            style={[
              styles.input,
              { backgroundColor: theme.backgroundElement, color: theme.text },
            ]}
            placeholder="Email"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
          />

          <TextInput
            style={[
              styles.input,
              { backgroundColor: theme.backgroundElement, color: theme.text },
            ]}
            placeholder="Password"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => {
              if (canSubmit) handleSignIn()
            }}
          />

          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable
            style={[
              styles.button,
              { backgroundColor: theme.backgroundSelected },
              !canSubmit && styles.buttonDisabled,
            ]}
            disabled={!canSubmit}
            onPress={handleSignIn}
          >
            {submitting ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <ThemedText type="smallBold">Sign in</ThemedText>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.four,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  error: {
    color: "#ef4444",
    textAlign: "center",
  },
  button: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
})
