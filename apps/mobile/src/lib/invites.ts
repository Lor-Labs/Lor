import * as SecureStore from "expo-secure-store"
import { env } from "./env"

export function inviteUrl(code: string) {
  return `${env.EXPO_PUBLIC_WEB_URL}/invite/${code}`
}

// Carries an invite code across sign-up, email verification and sign-in for
// signed-out users who open an invite link. Persisted so it survives the app
// being killed while the user opens the verification email.
const PENDING_INVITE_KEY = "lor.pending-invite"
const PENDING_INVITE_TTL_MS = 24 * 60 * 60 * 1000

export function setPendingInviteCode(code: string) {
  try {
    SecureStore.setItem(
      PENDING_INVITE_KEY,
      JSON.stringify({ code, savedAt: Date.now() })
    )
  } catch {
    // Best effort: without it the user pastes the invite link again.
  }
}

export function consumePendingInviteCode(): string | null {
  try {
    const stored = SecureStore.getItem(PENDING_INVITE_KEY)
    if (!stored) return null
    void SecureStore.deleteItemAsync(PENDING_INVITE_KEY)
    const { code, savedAt } = JSON.parse(stored) as {
      code?: unknown
      savedAt?: unknown
    }
    const fresh =
      typeof savedAt === "number" &&
      Date.now() - savedAt < PENDING_INVITE_TTL_MS
    return fresh && typeof code === "string" ? code : null
  } catch {
    return null
  }
}

export function parseInviteCode(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^[A-Za-z0-9]+$/.test(trimmed)) {
    return trimmed
  }

  const inviteMatch = trimmed.match(
    /(?:^|\/)invite\/([A-Za-z0-9]+)(?:\/)?(?:[?#].*)?$/i
  )

  return inviteMatch?.[1] ?? null
}
