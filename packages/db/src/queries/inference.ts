import { randomUUID } from "node:crypto"
import { readServerEnv } from "@repo/env/server-fields"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import type { InferenceFunding, KeyProvider } from "@repo/utils/inference"
import { and, asc, db, eq, schema } from "../index"

function encryptionKey() {
  const key = readServerEnv(
    "INTEGRATION_ENCRYPTION_KEY"
  ).INTEGRATION_ENCRYPTION_KEY
  if (!key) throw new Error("Workspace key storage is not configured")
  return key
}

const keyOf = (workspaceId: string, provider: KeyProvider) =>
  and(
    eq(schema.workspaceInferenceKey.workspaceId, workspaceId),
    eq(schema.workspaceInferenceKey.provider, provider)
  )

export async function workspaceInferenceKeyId(
  workspaceId: string,
  provider: KeyProvider
) {
  return db
    .select({ keyId: schema.workspaceInferenceKey.keyId })
    .from(schema.workspaceInferenceKey)
    .where(keyOf(workspaceId, provider))
    .then((rows) => rows[0]?.keyId ?? null)
}

// A run on a workspace key stops once that key is replaced or removed.
// Lor-paid runs never depend on the workspace's keys.
export async function assertInferenceKeyCurrent(
  workspaceId: string,
  funding: InferenceFunding | null
) {
  if (funding?.source !== "byok") return
  if (
    (await workspaceInferenceKeyId(workspaceId, funding.provider)) !==
    funding.keyId
  )
    throw new Error(
      "The workspace API key changed. Start a new response to use the updated key."
    )
}

export async function loadWorkspaceInferenceKey(
  workspaceId: string,
  funding: Extract<InferenceFunding, { source: "byok" }>
) {
  const row = await db
    .select({
      keyId: schema.workspaceInferenceKey.keyId,
      encryptedKey: schema.workspaceInferenceKey.encryptedKey,
    })
    .from(schema.workspaceInferenceKey)
    .where(keyOf(workspaceId, funding.provider))
    .then((rows) => rows[0])
  if (!row || row.keyId !== funding.keyId)
    throw new Error(
      "The workspace API key changed; this response has been paused"
    )
  return decryptSecret(row.encryptedKey, encryptionKey())
}

export async function saveWorkspaceInferenceKey(input: {
  workspaceId: string
  provider: KeyProvider
  apiKey: string
  createdById: string
}) {
  const values = {
    keyId: randomUUID(),
    encryptedKey: encryptSecret(input.apiKey, encryptionKey()),
    lastFour: input.apiKey.slice(-4),
    createdById: input.createdById,
    createdAt: new Date(),
  }
  await db
    .insert(schema.workspaceInferenceKey)
    .values({
      workspaceId: input.workspaceId,
      provider: input.provider,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        schema.workspaceInferenceKey.workspaceId,
        schema.workspaceInferenceKey.provider,
      ],
      set: values,
    })
}

// Masked keys for billing settings and the composer's key-paid models.
export async function workspaceInferenceKeys(workspaceId: string) {
  return db
    .select({
      provider: schema.workspaceInferenceKey.provider,
      lastFour: schema.workspaceInferenceKey.lastFour,
      createdAt: schema.workspaceInferenceKey.createdAt,
      createdBy: schema.user.name,
    })
    .from(schema.workspaceInferenceKey)
    .leftJoin(
      schema.user,
      eq(schema.workspaceInferenceKey.createdById, schema.user.id)
    )
    .where(eq(schema.workspaceInferenceKey.workspaceId, workspaceId))
    .orderBy(asc(schema.workspaceInferenceKey.provider))
}

export async function removeWorkspaceInferenceKey(
  workspaceId: string,
  provider: KeyProvider
) {
  await db
    .delete(schema.workspaceInferenceKey)
    .where(keyOf(workspaceId, provider))
}
