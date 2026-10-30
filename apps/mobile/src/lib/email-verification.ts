import * as SecureStore from "expo-secure-store"

// Mirrors the expo plugin's internal storage key: `${storagePrefix}_cookie`
// with the "lor" prefix configured in auth-client.ts.
export const COOKIE_STORAGE_KEY = "lor_cookie"
const PENDING_VERIFICATION_KEY = "lor.pending-email-verification"
const PENDING_VERIFICATION_TTL_MS = 60 * 60 * 1000

// Set when this device asks for a verification email (sign-up, resend, or a
// sign-in that better-auth answers with a new email).
export function markEmailVerificationPending() {
  try {
    SecureStore.setItem(PENDING_VERIFICATION_KEY, String(Date.now()))
  } catch {
    // Best effort: without it the link asks the person to sign in.
  }
}

function hasStoredSession() {
  try {
    const jar = JSON.parse(
      SecureStore.getItem(COOKIE_STORAGE_KEY) ?? "{}"
    ) as Record<string, { value?: string; expires?: string | null }> | null
    return Object.entries(jar ?? {}).some(
      ([name, cookie]) =>
        name.includes("session_token") &&
        Boolean(cookie?.value) &&
        (!cookie.expires || new Date(cookie.expires) > new Date())
    )
  } catch {
    return false
  }
}

// Login CSRF guard for lor://verify-email?cookie=…: anyone can send that link,
// so the session cookie is taken only when this device asked for a
// verification email in the last hour and nobody is signed in here.
export function canAcceptVerificationCookie() {
  try {
    const pendingSince = Number(SecureStore.getItem(PENDING_VERIFICATION_KEY))
    void SecureStore.deleteItemAsync(PENDING_VERIFICATION_KEY)
    const fresh =
      Number.isFinite(pendingSince) &&
      pendingSince > 0 &&
      Date.now() - pendingSince < PENDING_VERIFICATION_TTL_MS
    return fresh && !hasStoredSession()
  } catch {
    return false
  }
}
