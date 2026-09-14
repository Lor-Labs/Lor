import { APP_USER_ID } from "../constants"
import { db } from "../index"
import { user } from "../schemas/users"

// Idempotent. Run at setup, or use the equivalent SQL insert directly.
export async function seedAppUser() {
  await db
    .insert(user)
    .values({
      id: APP_USER_ID,
      name: "App",
      email: "app@lor.chat",
      emailVerified: true,
      onboardingCompleted: true,
      isBot: true,
    })
    .onConflictDoNothing({ target: user.id })
}
