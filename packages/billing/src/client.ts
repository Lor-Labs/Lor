import { env } from "@repo/env/server"
import { Autumn } from "autumn-js"

export const billingEnabled = Boolean(env.AUTUMN_SECRET_KEY)

let client: Autumn | null = null

export function getAutumn(): Autumn | null {
  if (!env.AUTUMN_SECRET_KEY) return null
  if (!client) client = new Autumn({ secretKey: env.AUTUMN_SECRET_KEY })
  return client
}
