const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(value: string): string | null {
  const email = value.trim()
  if (!email) return "Email is required."
  if (!EMAIL_PATTERN.test(email)) return "Enter a complete email address."
  return null
}
