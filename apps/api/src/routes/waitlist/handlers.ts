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

  // Same response for a repeat email, so the endpoint can't reveal who
  // is already on the list.
  if (entry) void notifyWaitlistSignup(entry)
  return c.json({ success: true }, 200)
}
