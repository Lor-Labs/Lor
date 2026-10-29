import { randomUUID } from "node:crypto"
import { readServerEnv } from "@repo/env/server-fields"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import type { InferenceFunding } from "@repo/utils/inference"
import { db, eq, schema } from "../index"

function encryptionKey() {
  const key = readServerEnv(
    "INTEGRATION_ENCRYPTION_KEY"
  ).INTEGRATION_ENCRYPTION_KEY
  if (!key) throw new Error("Workspace key storage is not configured")
  return key
}

export async function workspaceInferenceFunding(
  workspaceId: string
): Promise<InferenceFunding> {
  const row = await db
    .select({
      keyId: schema.workspaceInferenceKey.keyId,
      provider: schema.workspaceInferenceKey.provider,
      model: schema.workspaceInferenceKey.model,
    })
    .from(schema.workspaceInferenceKey)
    .where(eq(schema.workspaceInferenceKey.workspaceId, workspaceId))
    .then((rows) => rows[0])
  return row ? { source: "byok", ...row } : { source: "lor" }
}

export async function assertInferenceFundingCurrent(
  workspaceId: string,
  funding: InferenceFunding
) {
  const current = await workspaceInferenceFunding(workspaceId)
  if (
    current.source !== funding.source ||
    (current.source === "byok" &&
      funding.source === "byok" &&
      current.keyId !== funding.keyId)
  )
    throw new Error(
      "The workspace AI funding changed. Start a new response to use the updated settings."
    )
}

export async function loadWorkspaceInferenceKey(
  workspaceId: string,
  funding: Extract<InferenceFunding, { source: "byok" }>
) {
  const row = await db
    .select()
    .from(schema.workspaceInferenceKey)
    .where(eq(schema.workspaceInferenceKey.workspaceId, workspaceId))
    .then((rows) => rows[0])
  if (!row || row.keyId !== funding.keyId || row.provider !== funding.provider)
    throw new Error(
      "The workspace API key changed; this response has been paused"
    )
  return decryptSecret(row.encryptedKey, encryptionKey())
}

export async function saveWorkspaceInferenceKey(input: {
  workspaceId: string
  provider: "anthropic" | "openai"
  model: string
  apiKey: string
}) {
  const values = {
    keyId: randomUUID(),
    provider: input.provider,
    model: input.model,
    encryptedKey: encryptSecret(input.apiKey, encryptionKey()),
    lastFour: input.apiKey.slice(-4),
    updatedAt: new Date(),
  }
  await db
    .insert(schema.workspaceInferenceKey)
    .values({ workspaceId: input.workspaceId, ...values })
    .onConflictDoUpdate({
      target: schema.workspaceInferenceKey.workspaceId,
      set: values,
    })
}

export async function workspaceInferenceSummary(workspaceId: string) {
  return db
    .select({
      provider: schema.workspaceInferenceKey.provider,
      model: schema.workspaceInferenceKey.model,
      lastFour: schema.workspaceInferenceKey.lastFour,
    })
    .from(schema.workspaceInferenceKey)
    .where(eq(schema.workspaceInferenceKey.workspaceId, workspaceId))
    .then((rows) => rows[0] ?? null)
}

export async function removeWorkspaceInferenceKey(workspaceId: string) {
  await db
    .delete(schema.workspaceInferenceKey)
    .where(eq(schema.workspaceInferenceKey.workspaceId, workspaceId))
}
