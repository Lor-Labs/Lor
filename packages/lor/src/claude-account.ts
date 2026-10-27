import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret } from "@repo/utils/crypto"

// A person's own Claude subscription token (Settings → Linked accounts), for
// Claude Code turns they start themselves, never anyone else's
// (code-sessions-runbook.md chunk 7). Null when none is connected.
export async function claudeSubscriptionToken(
  userId: string
): Promise<string | null> {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) return null
  const [account] = await db
    .select({ accessToken: schema.personalAccount.accessToken })
    .from(schema.personalAccount)
    .where(
      and(
        eq(schema.personalAccount.userId, userId),
        eq(schema.personalAccount.provider, "claude")
      )
    )
    .limit(1)
  return account ? decryptSecret(account.accessToken, key) : null
}
