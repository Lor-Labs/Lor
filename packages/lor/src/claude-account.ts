import { and, db, eq, schema } from "@repo/db"
import type { ReportedHarnessModel } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { decryptSecret } from "@repo/utils/crypto"

const claudeAccount = (userId: string) =>
  and(
    eq(schema.personalAccount.userId, userId),
    eq(schema.personalAccount.provider, "claude")
  )

// The models the person's Claude Code offered on their last turn, for the
// composer's picker. Null until a turn reports them.
export async function claudeModels(
  userId: string
): Promise<ReportedHarnessModel[] | null> {
  const [account] = await db
    .select({ models: schema.personalAccount.models })
    .from(schema.personalAccount)
    .where(claudeAccount(userId))
    .limit(1)
  return account?.models ?? null
}

export async function saveClaudeModels(
  userId: string,
  models: ReportedHarnessModel[]
): Promise<void> {
  await db
    .update(schema.personalAccount)
    .set({ models })
    .where(claudeAccount(userId))
}

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
    .where(claudeAccount(userId))
    .limit(1)
  return account ? decryptSecret(account.accessToken, key) : null
}
