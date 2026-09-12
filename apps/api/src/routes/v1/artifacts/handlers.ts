import type { z } from "@hono/zod-openapi"
import { and, db, desc, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  GetArtifactRoute,
  ListPlanArtifactsRoute,
} from "@/routes/v1/artifacts/routes"
import type { getArtifactResponseSchema } from "@/routes/v1/artifacts/schema"

const blobUrl = (blobKey: string) => `${env.S3_PUBLIC_URL}/${blobKey}`

export const getArtifact: AppRouteHandler<GetArtifactRoute> = async (c) => {
  const currentUser = c.var.user
  const { artifactId } = c.req.valid("param")

  const row = await db
    .select({
      artifact: schema.artifact,
      channelWorkspaceId: schema.channel.workspaceId,
    })
    .from(schema.artifact)
    .innerJoin(schema.channel, eq(schema.artifact.channelId, schema.channel.id))
    .where(eq(schema.artifact.id, artifactId))
    .limit(1)
    .then((rows) => rows[0])

  if (!row) {
    return c.json(
      { success: false as const, message: "Artifact not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (row.channelWorkspaceId !== row.artifact.workspaceId) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  const canAccess = await userCanAccessChannel(
    row.artifact.channelId,
    currentUser.id
  )
  if (!canAccess) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  // Bounded: versions are append-only and currentVersion is always the max,
  // so the newest page always contains the current version.
  const versions = await db
    .select()
    .from(schema.artifactVersion)
    .where(eq(schema.artifactVersion.artifactId, artifactId))
    .orderBy(desc(schema.artifactVersion.version))
    .limit(200)

  const current = versions.find(
    (v) => v.version === row.artifact.currentVersion
  )

  const payload: z.infer<typeof getArtifactResponseSchema> = {
    artifact: serializeArtifact(row.artifact, current ?? null),
    versions: versions.map((v) => ({
      version: v.version,
      baseVersion: v.baseVersion,
      size: v.size,
      contentType: v.contentType,
      authorType: v.authorType,
      authorId: v.authorId,
      url: blobUrl(v.blobKey),
      createdAt: v.createdAt.toISOString(),
    })),
  }
  return c.json(payload, HttpStatusCodes.OK)
}

export const listPlanArtifacts: AppRouteHandler<
  ListPlanArtifactsRoute
> = async (c) => {
  const currentUser = c.var.user
  const { planId } = c.req.valid("param")

  const planRow = await db
    .select({
      id: schema.plan.id,
      channelId: schema.plan.channelId,
      workspaceId: schema.plan.workspaceId,
      channelWorkspaceId: schema.channel.workspaceId,
    })
    .from(schema.plan)
    .innerJoin(schema.channel, eq(schema.plan.channelId, schema.channel.id))
    .where(eq(schema.plan.id, planId))
    .limit(1)
    .then((rows) => rows[0])

  if (!planRow) {
    return c.json(
      { success: false as const, message: "Plan not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  if (planRow.channelWorkspaceId !== planRow.workspaceId) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }
  const canAccess = await userCanAccessChannel(
    planRow.channelId,
    currentUser.id
  )
  if (!canAccess) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const rows = await db
    .select({
      artifact: schema.artifact,
      currentVersion: schema.artifactVersion,
    })
    .from(schema.artifact)
    .leftJoin(
      schema.artifactVersion,
      and(
        eq(schema.artifactVersion.artifactId, schema.artifact.id),
        eq(schema.artifactVersion.version, schema.artifact.currentVersion)
      )
    )
    .where(eq(schema.artifact.planId, planId))
    .orderBy(desc(schema.artifact.createdAt))
    .limit(100)

  return c.json(
    {
      artifacts: rows.map((r) =>
        serializeArtifact(r.artifact, r.currentVersion)
      ),
    },
    HttpStatusCodes.OK
  )
}

// Shared with the loops run-history endpoint (same artifact wire shape).
export function serializeArtifact(
  artifact: typeof schema.artifact.$inferSelect,
  current: typeof schema.artifactVersion.$inferSelect | null
) {
  return {
    id: artifact.id,
    workspaceId: artifact.workspaceId,
    channelId: artifact.channelId,
    planId: artifact.planId,
    path: artifact.path,
    mime: artifact.mime,
    currentVersion: artifact.currentVersion,
    url: current ? blobUrl(current.blobKey) : null,
    size: current ? current.size : null,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  }
}
