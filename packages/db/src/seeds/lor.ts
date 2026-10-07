import { LOR_USER_ID } from "../constants"
import { db } from "../index"
import { user } from "../schemas/users"

// Idempotent. Run at setup, or use the equivalent SQL insert directly.
// Renaming an existing deployment's row is a manual UPDATE (see
// reference/archive/lor-rename.md §3) — the id conflict target skips it here.
export async function seedLorUser() {
  await db
    .insert(user)
    .values({
      id: LOR_USER_ID,
      name: "Lor",
      email: "lor@lor.chat",
      emailVerified: true,
      onboardingCompleted: true,
      isBot: true,
    })
    .onConflictDoNothing({ target: user.id })
}
