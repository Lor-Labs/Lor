import { createHmac, timingSafeEqual } from "node:crypto"
import { env } from "@repo/env/server"

// Email invite links carry an HMAC of the invitation id. Admins can list
// invitation ids, so only the signed link proves the holder owns the inbox,
// which lets an invite sign-up skip email verification.
function sign(invitationId: string) {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`invitation.${invitationId}`)
    .digest("base64url")
}

export function invitationUrl(invitationId: string) {
  return `${env.APP_BASE_URL}/invitations/${invitationId}?sig=${sign(invitationId)}`
}

export function verifyInvitationSignature(invitationId: string, sig: string) {
  const got = Buffer.from(sig)
  const want = Buffer.from(sign(invitationId))
  return got.length === want.length && timingSafeEqual(got, want)
}
