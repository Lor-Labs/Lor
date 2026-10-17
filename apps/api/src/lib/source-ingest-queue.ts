import { and, db, eq, schema } from "@repo/db"
import type { IntegrationProvider } from "@repo/db/schema"
import { env } from "@repo/env/server"
import {
  SOURCE_INGEST_QUEUE,
  type SourceIngestJobData,
} from "@repo/realtime-types/queues"
import { Queue } from "bullmq"

// Source ingestion producer: a provider webhook is a signal to refetch the
// item, never the content. reference/planned/context-engine-phase-2.md.

function parseRedisUrl(url: string) {
  const parsed = new URL(url)
  const dbIndex = Number.parseInt(parsed.pathname.slice(1), 10)
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    db: Number.isFinite(dbIndex) ? dbIndex : 0,
  }
}

// A burst of events for one item (a review with ten comments) waits this
// long and makes one fetch. Events inside the window are deduplicated; one
// after the fetch starts makes a new job, so no change is missed.
const SETTLE_MS = 15_000

let ingestQueue: Queue<SourceIngestJobData> | null = null
function getIngestQueue(): Queue<SourceIngestJobData> {
  ingestQueue ??= new Queue<SourceIngestJobData>(SOURCE_INGEST_QUEUE, {
    connection: { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null },
    defaultJobOptions: {
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 7 * 86400, count: 1000 },
    },
  })
  return ingestQueue
}

export type IngestConnection = Pick<
  typeof schema.integrationConnection.$inferSelect,
  "id" | "workspaceId" | "provider"
>

// The active connection a provider event belongs to; null when none is mapped.
export async function ingestConnection(
  provider: IntegrationProvider,
  externalId: string
): Promise<IngestConnection | null> {
  const row = await db
    .select({
      id: schema.integrationConnection.id,
      workspaceId: schema.integrationConnection.workspaceId,
      provider: schema.integrationConnection.provider,
    })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.provider, provider),
        eq(schema.integrationConnection.externalId, externalId),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  return row ?? null
}

export async function enqueueSourceIngest(
  connectionId: string,
  kind: string,
  ref: string
): Promise<void> {
  await getIngestQueue().add(
    "ingest",
    { connectionId, kind, ref },
    {
      delay: SETTLE_MS,
      deduplication: { id: `${connectionId}-${kind}-${ref}`, ttl: SETTLE_MS },
      attempts: 5,
      backoff: { type: "exponential", delay: 60_000 },
    }
  )
}
