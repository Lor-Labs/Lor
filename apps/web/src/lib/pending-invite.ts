// Carries an invite code from the public /invite/$code route into the
// onboarding dialog (rendered under _authenticated) so a freshly-signed-up
// user picks a username before the invite is accepted. localStorage rather
// than sessionStorage so it survives the email-verification round-trip, which
// can land in a new tab. Consumed (read + cleared) once by the layout.
const PENDING_INVITE_KEY = "lor:pending-invite"

export function readPendingInvite(): string | null {
  try {
    return localStorage.getItem(PENDING_INVITE_KEY)
  } catch {
    return null
  }
}

export function writePendingInvite(code: string) {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, code)
  } catch {}
}

export function clearPendingInvite() {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY)
  } catch {}
}
