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

// Personal mailbox providers: an address here says nothing about a company,
// so onboarding prefill and domain join ignore them.
const FREE_EMAIL_DOMAINS = new Set([
  "126.com",
  "163.com",
  "aim.com",
  "aol.com",
  "att.net",
  "bk.ru",
  "btinternet.com",
  "comcast.net",
  "duck.com",
  "fastmail.com",
  "free.fr",
  "gmail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "googlemail.com",
  "hanmail.net",
  "hey.com",
  "hotmail.co.uk",
  "hotmail.com",
  "hotmail.fr",
  "icloud.com",
  "inbox.ru",
  "interia.pl",
  "laposte.net",
  "libero.it",
  "list.ru",
  "live.com",
  "mac.com",
  "mail.com",
  "mail.ru",
  "me.com",
  "msn.com",
  "naver.com",
  "o2.pl",
  "onet.pl",
  "orange.fr",
  "outlook.com",
  "pm.me",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "rambler.ru",
  "rediffmail.com",
  "rocketmail.com",
  "sbcglobal.net",
  "seznam.cz",
  "sky.com",
  "t-online.de",
  "tuta.io",
  "tutanota.com",
  "verizon.net",
  "web.de",
  "wp.pl",
  "yahoo.co.uk",
  "yahoo.com",
  "yahoo.fr",
  "yandex.com",
  "yandex.ru",
  "ymail.com",
  "zoho.com",
])

export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase())
}

// The company domain behind an email address, or null for personal mailboxes.
export function companyEmailDomain(email: string): string | null {
  const at = email.lastIndexOf("@")
  if (at < 0) return null
  const domain = normalizeDomain(email.slice(at + 1))
  return domain && !isFreeEmailDomain(domain) ? domain : null
}
