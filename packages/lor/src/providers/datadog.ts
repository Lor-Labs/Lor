import { createHash } from "node:crypto"
import { and, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import { logger } from "../logger"
import type { SourceProvider } from "./types"

const REQUEST_TIMEOUT_MS = 10_000

function encryptionKey(): string {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is not set; Datadog is unavailable"
    )
  }
  return key
}

export type DatadogCredentials = {
  site: string
  apiKey: string
  appKey: string
}

// One authenticated logs read: exercises the API key, the application key, and
// the logs read scope in a single call.
async function verifyKeys(creds: DatadogCredentials): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.${creds.site}/api/v2/logs/events?page[limit]=1`,
      {
        headers: {
          "DD-API-KEY": creds.apiKey,
          "DD-APPLICATION-KEY": creds.appKey,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    )
    if (!res.ok) {
      logger.warn({ status: res.status }, "Datadog key verification failed")
    }
    return res.ok
  } catch (err) {
    logger.error({ err }, "Datadog key verification error")
    return false
  }
}

// Verify pasted keys and return a ready-to-store connection. Datadog has no
// org-id endpoint the app key is guaranteed to reach, so the connection's
// external id is a fingerprint of the API key (stable per key, provider-scoped).
export async function connectDatadog(creds: DatadogCredentials): Promise<{
  externalId: string
  accountLabel: string
  apiKey: string
  appKey: string
} | null> {
  const key = encryptionKey()
  if (!(await verifyKeys(creds))) return null
  return {
    externalId: createHash("sha256").update(creds.apiKey).digest("hex"),
    accountLabel: creds.site,
    apiKey: encryptSecret(creds.apiKey, key),
    appKey: encryptSecret(creds.appKey, key),
  }
}

export async function getDatadogCredentials(
  externalId: string
): Promise<DatadogCredentials | null> {
  const key = encryptionKey()
  const row = await db
    .select({
      apiKey: schema.integrationConnection.apiKey,
      appKey: schema.integrationConnection.appKey,
      site: schema.integrationConnection.site,
    })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.provider, "datadog"),
        eq(schema.integrationConnection.externalId, externalId),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  if (!(row?.apiKey && row.appKey && row.site)) return null
  try {
    return {
      site: row.site,
      apiKey: decryptSecret(row.apiKey, key),
      appKey: decryptSecret(row.appKey, key),
    }
  } catch {
    return null
  }
}

// No ingestion: Datadog is on-demand tools only (log volume rules out eager
// `source` rows).
export const datadogProvider: SourceProvider = {
  async verifyConnection(connection) {
    const creds = await getDatadogCredentials(connection.externalId)
    if (!creds) return null
    return (await verifyKeys(creds)) ? { accountLabel: creds.site } : null
  },
}
