import { randomUUID } from "node:crypto"
import { readServerEnv } from "@repo/env/server-fields"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import {
  type InferenceCredential,
  type InferenceFunding,
  type InferenceKeyConfig,
  inferenceKeyConfig,
  inferenceKeyHint,
  type KeyProvider,
} from "@repo/utils/inference"
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

// Anthropic/OpenAI rows store the bare API key; the cloud providers store
// their JSON credential.
function encodeCredential(credential: InferenceCredential) {
  if (credential.provider === "anthropic" || credential.provider === "openai")
    return credential.apiKey
  const { provider: _, ...rest } = credential
  return JSON.stringify(rest)
}

function decodeCredential(
  provider: KeyProvider,
  plaintext: string
): InferenceCredential {
  if (provider === "anthropic" || provider === "openai")
    return { provider, apiKey: plaintext }
  return { provider, ...JSON.parse(plaintext) } as InferenceCredential
}

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

// The key's identity and non-secret settings, to check a model pick against
// what the provider was set up to run.
export async function workspaceInferenceKeyRef(
  workspaceId: string,
  provider: KeyProvider
): Promise<{ keyId: string; config: InferenceKeyConfig } | null> {
  const row = await db
    .select({
      keyId: schema.workspaceInferenceKey.keyId,
      config: schema.workspaceInferenceKey.config,
    })
    .from(schema.workspaceInferenceKey)
    .where(keyOf(workspaceId, provider))
    .then((rows) => rows[0])
  const config = row ? (row.config ?? legacyConfig(provider)) : null
  return row && config ? { keyId: row.keyId, config } : null
}

// Rows saved before config existed are Anthropic/OpenAI keys.
const legacyConfig = (provider: KeyProvider): InferenceKeyConfig | null =>
  provider === "anthropic" || provider === "openai" ? { provider } : null

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
      "The workspace's AI provider settings changed. Start a new response to use the updated settings."
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
      "The workspace's AI provider settings changed; this response has been paused"
    )
  return decodeCredential(
    funding.provider,
    decryptSecret(row.encryptedKey, encryptionKey())
  )
}

// The saved credential, so an edit can keep secrets the form left blank.
export async function currentWorkspaceInferenceCredential(
  workspaceId: string,
  provider: KeyProvider
) {
  const row = await db
    .select({ encryptedKey: schema.workspaceInferenceKey.encryptedKey })
    .from(schema.workspaceInferenceKey)
    .where(keyOf(workspaceId, provider))
    .then((rows) => rows[0])
  return row
    ? decodeCredential(
        provider,
        decryptSecret(row.encryptedKey, encryptionKey())
      )
    : null
}

export async function saveWorkspaceInferenceKey(input: {
  workspaceId: string
  credential: InferenceCredential
  createdById: string
}) {
  const values = {
    keyId: randomUUID(),
    encryptedKey: encryptSecret(
      encodeCredential(input.credential),
      encryptionKey()
    ),
    lastFour: inferenceKeyHint(input.credential),
    config: inferenceKeyConfig(input.credential),
    createdById: input.createdById,
    createdAt: new Date(),
  }
  await db
    .insert(schema.workspaceInferenceKey)
    .values({
      workspaceId: input.workspaceId,
      provider: input.credential.provider,
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

// Masked providers for AI provider settings and the composer's key-paid
// models.
export async function workspaceInferenceKeys(workspaceId: string) {
  const rows = await db
    .select({
      provider: schema.workspaceInferenceKey.provider,
      lastFour: schema.workspaceInferenceKey.lastFour,
      config: schema.workspaceInferenceKey.config,
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
  return rows.flatMap((row) => {
    const config = row.config ?? legacyConfig(row.provider)
    return config ? [{ ...row, config }] : []
  })
}

export async function removeWorkspaceInferenceKey(
  workspaceId: string,
  provider: KeyProvider
) {
  await db
    .delete(schema.workspaceInferenceKey)
    .where(keyOf(workspaceId, provider))
}
