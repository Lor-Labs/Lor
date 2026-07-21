import { env } from "./env"

export function inviteUrl(code: string) {
  return `${env.EXPO_PUBLIC_WEB_URL}/invite/${code}`
}

// Carries an invite code across the sign-in redirect for signed-out users
// who open an invite deep link.
let pendingInviteCode: string | null = null

export function setPendingInviteCode(code: string) {
  pendingInviteCode = code
}

export function consumePendingInviteCode() {
  const code = pendingInviteCode
  pendingInviteCode = null
  return code
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
