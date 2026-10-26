import { and, eq } from "drizzle-orm"
import { db } from "../index"
import {
  type PersonalAccountProvider,
  personalAccount,
} from "../schemas/personal-accounts"

// Whether a person linked their own account at a provider: a Claude Code
// turn runs only on the sender's own Claude subscription.
export async function hasPersonalAccount(
  userId: string,
  provider: PersonalAccountProvider
): Promise<boolean> {
  const [row] = await db
    .select({ id: personalAccount.id })
    .from(personalAccount)
    .where(
      and(
        eq(personalAccount.userId, userId),
        eq(personalAccount.provider, provider)
      )
    )
    .limit(1)
  return Boolean(row)
}
