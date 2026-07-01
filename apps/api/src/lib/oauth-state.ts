import { createHmac, timingSafeEqual } from "node:crypto"
import { env } from "@repo/env/server"

// Short-lived, HMAC-signed OAuth `state`. Binds the flow to the initiating user
// + workspace so a returned code can't be replayed against another session
// (OAuth connection fixation). Format: `<slug>.<expMs>.<sig>` — the slug is
// readable so the callback can route without trusting it; the signature is what
// the connect handler verifies. Slugs are dot-free, so splitting on "." is safe.
const STATE_TTL_MS = 10 * 60 * 1000

function sign(payload: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(payload)
    .digest("base64url")
}

export function signOAuthState(slug: string, userId: string): string {
  const expMs = Date.now() + STATE_TTL_MS
  return `${slug}.${expMs}.${sign(`${slug}.${expMs}.${userId}`)}`
}

// The bound workspace slug when the state is authentic, unexpired, and minted
// for this user; null otherwise.
export function verifyOAuthState(state: string, userId: string): string | null {
  const [slug, expRaw, sig, ...rest] = state.split(".")
  if (!(slug && expRaw && sig) || rest.length > 0) return null
  const expMs = Number(expRaw)
  if (!Number.isFinite(expMs) || expMs < Date.now()) return null
  const expected = sign(`${slug}.${expMs}.${userId}`)
  const got = Buffer.from(sig)
  const want = Buffer.from(expected)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  return slug
}
