import { and, db, eq, schema, sql } from "@repo/db"
import { logger } from "../logger"
import {
  artifactBlobKey,
  artifactPublicUrl,
  putArtifactObject,
} from "./storage"

export type WriteArtifactVersionInput = {
  workspaceId: string
  channelId: string
  planId?: string | null
  // Logical filename within the plan workspace, e.g. "report.md".
  path: string
  contentType: string
  bytes: Uint8Array
  authorType: "agent" | "user"
  authorId: string
  // The version this write was derived from. Defaults to the version being
  // superseded (null for a first version).
  baseVersion?: number | null
}

export type ArtifactManifestEntry = {
  artifactId: string
  path: string
  contentType: string
  size: number
  version: number
  url: string
}

// The single write path for artifact content — sandbox harvest, human edits,
// and future collaborative-session flushes all commit through here. Blob
// upload happens before the version commit: a failure can orphan a blob but
// never a version row pointing at missing bytes.
export async function writeArtifactVersion(
  input: WriteArtifactVersionInput
): Promise<ArtifactManifestEntry> {
  const artifactRow = await resolveArtifact(input)
  const blobKey = artifactBlobKey(input.workspaceId, artifactRow.id, input.path)
  await putArtifactObject(blobKey, input.bytes, input.contentType)

  const version = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.artifact)
      .set({
        currentVersion: sql`${schema.artifact.currentVersion} + 1`,
        mime: input.contentType,
      })
      .where(eq(schema.artifact.id, artifactRow.id))
      .returning({ version: schema.artifact.currentVersion })
      .then((rows) => rows[0])
    if (!updated) throw new Error(`artifact ${artifactRow.id} disappeared`)

    await tx.insert(schema.artifactVersion).values({
      artifactId: artifactRow.id,
      version: updated.version,
      baseVersion:
        input.baseVersion ?? (updated.version > 1 ? updated.version - 1 : null),
      blobKey,
      size: input.bytes.byteLength,
      contentType: input.contentType,
      authorType: input.authorType,
      authorId: input.authorId,
    })
    return updated.version
  })

  logger.info(
    { artifactId: artifactRow.id, path: input.path, version },
    "artifact version committed"
  )

  return {
    artifactId: artifactRow.id,
    path: input.path,
    contentType: input.contentType,
    size: input.bytes.byteLength,
    version,
    url: artifactPublicUrl(blobKey),
  }
}

// Within a plan, (planId, path) names one artifact and repeated writes
// version it; outside a plan every write is a fresh artifact.
async function resolveArtifact(
  input: WriteArtifactVersionInput
): Promise<{ id: string }> {
  const values = {
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    planId: input.planId ?? null,
    path: input.path,
    mime: input.contentType,
    createdById: input.authorId,
  }

  if (!input.planId) {
    const inserted = await db
      .insert(schema.artifact)
      .values(values)
      .returning({ id: schema.artifact.id })
      .then((rows) => rows[0])
    if (!inserted) throw new Error("artifact insert returned no row")
    return inserted
  }

  const existing = await findPlanArtifact(input.planId, input.path)
  if (existing) return existing

  const inserted = await db
    .insert(schema.artifact)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: schema.artifact.id })
    .then((rows) => rows[0])
  if (inserted) return inserted

  // Lost the insert race — the winner's row is the artifact.
  const raced = await findPlanArtifact(input.planId, input.path)
  if (!raced) throw new Error("artifact upsert failed")
  return raced
}

async function findPlanArtifact(
  planId: string,
  path: string
): Promise<{ id: string } | null> {
  const row = await db
    .select({ id: schema.artifact.id })
    .from(schema.artifact)
    .where(
      and(eq(schema.artifact.planId, planId), eq(schema.artifact.path, path))
    )
    .limit(1)
    .then((rows) => rows[0])
  return row ?? null
}

export { artifactPublicUrl }
