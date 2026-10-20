import { db } from "@repo/db"
import { waitlist } from "@repo/db/schema"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { notifyWaitlistSignup } from "@/lib/waitlist-notifications"
import type { CreateWaitlistEntryRoute } from "@/routes/waitlist/routes"

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const createWaitlistEntry: AppRouteHandler<
  CreateWaitlistEntryRoute
> = async (c) => {
  const body = c.req.valid("json")
  const email = body.email.trim().toLowerCase()

  if (email.length > 254 || !emailRegex.test(email)) {
    return c.json({ error: "A valid email is required" }, 400)
  }

  const [entry] = await db
    .insert(waitlist)
    .values({ email })
    .onConflictDoNothing({ target: waitlist.email })
    .returning()

  if (!entry) {
    return c.json({ error: "This email is already on the waitlist" }, 409)
  }

  void notifyWaitlistSignup(entry)
  return c.json({ success: true }, 200)
}
