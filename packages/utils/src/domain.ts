const MAX_DOMAIN_LENGTH = 253

// Normalizes a typed website ("https://www.Acme.com/about", "acme.com") to a
// bare lowercase hostname without "www.". Returns null when it isn't a
// public-looking domain.
export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let hostname: string
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
    hostname = new URL(withScheme).hostname.toLowerCase()
  } catch {
    return null
  }

  const domain = hostname.replace(/^www\./, "").replace(/\.$/, "")
  if (domain.length > MAX_DOMAIN_LENGTH) return null
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null
  if (/^\d+(\.\d+)+$/.test(domain)) return null
  return domain
}
