import { z } from "zod"

/** 20 MB default — keep in sync with server.ts */
const DEFAULT_MAX_FILE_UPLOAD_SIZE = 100 * 1024 * 1024

/** Adds a protocol to a URL if missing. Defaults to http:// for localhost/loopback, https:// otherwise. Preserves ws:// and wss:// schemes. */
const addProtocol = (url: string) => {
  const trimmed = url.trim()
  if (/^(https?|wss?):\/\//i.test(trimmed)) return trimmed
  const isLocal =
    trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1")
  return isLocal ? `http://${trimmed}` : `https://${trimmed}`
}

const isLoopbackHost = (hostname: string) =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]"

/** Web (invite-link) origin: http(s) only, http:// allowed only for true loopback hosts. */
const normalizeWebUrl = (value: string, ctx: z.RefinementCtx) => {
  const trimmed = value.trim()
  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  let parsed: URL
  try {
    parsed = new URL(hasProtocol ? trimmed : `https://${trimmed}`)
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "NEXT_PUBLIC_WEB_URL must be a valid URL",
    })
    return z.NEVER
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    ctx.addIssue({
      code: "custom",
      message: "NEXT_PUBLIC_WEB_URL must use http:// or https://",
    })
    return z.NEVER
  }
  if (parsed.search || parsed.hash) {
    ctx.addIssue({
      code: "custom",
      message:
        "NEXT_PUBLIC_WEB_URL must not include a query string or fragment",
    })
    return z.NEVER
  }
  const isLoopback = isLoopbackHost(parsed.hostname)
  if (parsed.protocol === "http:" && !isLoopback) {
    ctx.addIssue({
      code: "custom",
      message: "NEXT_PUBLIC_WEB_URL must use https:// for non-loopback hosts",
    })
    return z.NEVER
  }
  const protocol = hasProtocol
    ? parsed.protocol
    : isLoopback
      ? "http:"
      : "https:"
  return `${protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`
}

const clientSchema = z.object({
  NODE_ENV: z
    .enum(["development", "staging", "production", "test"])
    .default("production"),
  NEXT_PUBLIC_API_URL: z.string().min(1).transform(addProtocol),
  NEXT_PUBLIC_REALTIME_URL: z.string().min(1).transform(addProtocol),
  NEXT_PUBLIC_WEB_URL: z
    .string()
    .min(1)
    .default("https://app.lor.chat")
    .transform(normalizeWebUrl),
  NEXT_PUBLIC_MAX_FILE_UPLOAD_SIZE: z.coerce
    .number()
    .default(DEFAULT_MAX_FILE_UPLOAD_SIZE),
  NEXT_PUBLIC_SELF_HOSTED: z
    .preprocess((v) => v === "true" || v === "1", z.boolean())
    .default(false),
})

export const env = clientSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL,
  NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL,
  NEXT_PUBLIC_MAX_FILE_UPLOAD_SIZE:
    process.env.NEXT_PUBLIC_MAX_FILE_UPLOAD_SIZE,
  NEXT_PUBLIC_SELF_HOSTED: process.env.NEXT_PUBLIC_SELF_HOSTED,
})
