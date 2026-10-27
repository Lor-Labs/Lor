import { resolvePublicUrl } from "@repo/utils/network"
import { logger } from "@/lib/logger"

export async function isSafeUrl(urlString: string): Promise<boolean> {
  try {
    await resolvePublicUrl(urlString)
    return true
  } catch (err) {
    logger.warn({ err, url: urlString }, "URL safety check failed")
    return false
  }
}

const OG_PROXY_RULES: Array<{
  pattern: RegExp
  proxyHost: string
  siteName: string
}> = [
  {
    pattern: /^https?:\/\/(www\.)?(x\.com|twitter\.com)\//,
    proxyHost: "fxtwitter.com",
    siteName: "X (formerly Twitter)",
  },
]

export function matchProxyRule(originalUrl: string) {
  for (const rule of OG_PROXY_RULES) {
    if (rule.pattern.test(originalUrl)) {
      try {
        const parsed = new URL(originalUrl)
        parsed.hostname = rule.proxyHost
        return { fetchUrl: parsed.toString(), siteName: rule.siteName }
      } catch {
        return null
      }
    }
  }
  return null
}
