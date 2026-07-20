import { z } from "zod"

/** Adds a protocol to a URL if missing. Defaults to http:// for localhost/loopback, https:// otherwise. */
const addProtocol = (url: string) => {
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const isLocal =
    trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1")
  return isLocal ? `http://${trimmed}` : `https://${trimmed}`
}

const envSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().min(1).transform(addProtocol),
  EXPO_PUBLIC_REALTIME_URL: z.string().min(1).transform(addProtocol),
  EXPO_PUBLIC_WEB_URL: z.string().min(1).transform(addProtocol),
})

// Expo only inlines EXPO_PUBLIC_* vars that are referenced statically, so
// each one must be spelled out rather than passing process.env through.
export const env = envSchema.parse({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_REALTIME_URL: process.env.EXPO_PUBLIC_REALTIME_URL,
  EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL,
})
