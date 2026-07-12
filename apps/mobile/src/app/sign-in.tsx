import { Redirect } from "expo-router"
import { useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Radius, Spacing } from "@/constants/theme"
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
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <View style={styles.content}>
          <View style={[styles.mark, { backgroundColor: theme.accent }]}>
            <Text style={[styles.markText, { color: theme.accentForeground }]}>
              L
            </Text>
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: theme.text }]}>
              Welcome to Lor
            </Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Your team’s shared memory, in motion.
            </Text>
          </View>
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>
                Email
              </Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="you@company.com"
                placeholderTextColor={theme.textTertiary}
                style={[
                  styles.input,
                  {
                    borderColor: theme.border,
                    color: theme.text,
                    backgroundColor: theme.surface,
                  },
                ]}
                textContentType="emailAddress"
                value={email}
              />
            </View>
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>
                Password
              </Text>
              <TextInput
                autoComplete="current-password"
                onChangeText={setPassword}
                onSubmitEditing={() => void signIn()}
                placeholder="Your password"
                placeholderTextColor={theme.textTertiary}
                secureTextEntry
                style={[
                  styles.input,
                  {
                    borderColor: theme.border,
                    color: theme.text,
                    backgroundColor: theme.surface,
                  },
                ]}
                textContentType="password"
                value={password}
              />
            </View>
            {error && (
              <Text style={[styles.error, { color: theme.danger }]}>
                {error}
              </Text>
            )}
            <Pressable
              disabled={!canSubmit}
              onPress={() => void signIn()}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: canSubmit ? theme.accent : theme.divider },
                pressed && canSubmit && styles.buttonPressed,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={theme.accentForeground} />
              ) : (
                <Text
                  style={[
                    styles.buttonText,
                    {
                      color: canSubmit
                        ? theme.accentForeground
                        : theme.textTertiary,
                    },
                  ]}
                >
                  Sign in
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  keyboard: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.seven,
  },
  mark: {
    alignItems: "center",
    borderRadius: Radius.large,
    height: 52,
    justifyContent: "center",
    marginBottom: Spacing.seven,
    width: 52,
  },
  markText: { fontSize: 25, fontWeight: "700" },
  copy: { gap: Spacing.two, marginBottom: Spacing.eight },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6 },
  subtitle: { fontSize: 16, lineHeight: 22 },
  form: { gap: Spacing.four },
  field: { gap: Spacing.two },
  label: { fontSize: 13, fontWeight: "600" },
  input: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: Spacing.three,
  },
  error: { fontSize: 13, lineHeight: 18 },
  button: {
    alignItems: "center",
    borderRadius: Radius.medium,
    justifyContent: "center",
    minHeight: 52,
    marginTop: Spacing.two,
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
})
