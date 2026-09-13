import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
} from "@aws-sdk/client-cloudwatch-logs"
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts"
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
      "INTEGRATION_ENCRYPTION_KEY is not set; CloudWatch is unavailable"
    )
  }
  return key
}

export type CloudwatchCredentials = {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export function awsClientConfig(creds: CloudwatchCredentials) {
  return {
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
    maxAttempts: 2,
    requestHandler: { requestTimeout: REQUEST_TIMEOUT_MS },
  }
}

// Two authenticated calls: GetCallerIdentity resolves the AWS account id (the
// connection's external id) and DescribeLogGroups proves logs read access in
// the selected region.
async function verifyCredentials(
  creds: CloudwatchCredentials
): Promise<string | null> {
  try {
    const sts = new STSClient(awsClientConfig(creds))
    const identity = await sts.send(new GetCallerIdentityCommand({}))
    if (!identity.Account) return null

    const logs = new CloudWatchLogsClient(awsClientConfig(creds))
    await logs.send(new DescribeLogGroupsCommand({ limit: 1 }))
    return identity.Account
  } catch (err) {
    logger.warn({ err }, "CloudWatch credential verification failed")
    return null
  }
}

// Verify pasted keys and return a ready-to-store connection. Unlike Datadog,
// AWS has a real account identity — the external id is the AWS account id, so
// one account maps to one workspace regardless of which key pair connects it.
export async function connectCloudwatch(creds: CloudwatchCredentials): Promise<{
  externalId: string
  accountLabel: string
  accessKeyId: string
  secretAccessKey: string
} | null> {
  const key = encryptionKey()
  const accountId = await verifyCredentials(creds)
  if (!accountId) return null
  return {
    externalId: accountId,
    accountLabel: `${accountId} · ${creds.region}`,
    accessKeyId: encryptSecret(creds.accessKeyId, key),
    secretAccessKey: encryptSecret(creds.secretAccessKey, key),
  }
}

export async function getCloudwatchCredentials(
  externalId: string
): Promise<CloudwatchCredentials | null> {
  const key = encryptionKey()
  const row = await db
    .select({
      accessKeyId: schema.integrationConnection.apiKey,
      secretAccessKey: schema.integrationConnection.appKey,
      region: schema.integrationConnection.site,
    })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.provider, "cloudwatch"),
        eq(schema.integrationConnection.externalId, externalId),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  if (!(row?.accessKeyId && row.secretAccessKey && row.region)) return null
  try {
    return {
      region: row.region,
      accessKeyId: decryptSecret(row.accessKeyId, key),
      secretAccessKey: decryptSecret(row.secretAccessKey, key),
    }
  } catch {
    return null
  }
}

// No ingestion: CloudWatch is on-demand tools only (log volume rules out eager
// `sources` rows), so fetchContent has nothing to resolve.
export const cloudwatchProvider: SourceProvider = {
  async fetchContent() {
    return null
  },

  async verifyConnection(connection) {
    const creds = await getCloudwatchCredentials(connection.externalId)
    if (!creds) return null
    const accountId = await verifyCredentials(creds)
    return accountId ? { accountLabel: `${accountId} · ${creds.region}` } : null
  },
}
