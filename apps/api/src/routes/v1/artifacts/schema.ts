import { z } from "@hono/zod-openapi"
import { artifactAuthorTypeEnum } from "@repo/db/schema"

export const artifactParamsSchema = z.object({
  artifactId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "artifactId", in: "path", required: true },
    }),
})

export const planArtifactsParamsSchema = z.object({
  planId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "planId", in: "path", required: true },
    }),
})

export const artifactSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  channelId: z.string().uuid(),
  planId: z.string().uuid().nullable(),
  path: z.string(),
  mime: z.string(),
  currentVersion: z.number().int(),
  // Public URL of the current version's blob (null before a first commit).
  url: z.string().nullable(),
  size: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const artifactVersionSchema = z.object({
  version: z.number().int(),
  baseVersion: z.number().int().nullable(),
  size: z.number().int(),
  contentType: z.string(),
  authorType: z.enum(artifactAuthorTypeEnum.enumValues),
  authorId: z.string().uuid().nullable(),
  url: z.string(),
  createdAt: z.string(),
})

export const getArtifactResponseSchema = z.object({
  artifact: artifactSchema,
  conversation: z
    .object({
      messageId: z.string().uuid(),
      threadRootId: z.string().uuid().nullable(),
      sessionId: z.string().uuid().nullable(),
    })
    .nullable(),
  // Newest first.
  versions: z.array(artifactVersionSchema),
})

export const listPlanArtifactsResponseSchema = z.object({
  artifacts: z.array(artifactSchema),
})

export const channelFilesParamsSchema = z.object({
  channelId: z.string().uuid(),
})

export const channelFilesQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  kind: z.enum(["all", "artifact", "upload"]).default("all"),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})

export const channelFilesResponseSchema = z.object({
  files: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["artifact", "upload"]),
      artifactId: z.string().uuid().nullable(),
      name: z.string(),
      contentType: z.string(),
      size: z.number().nullable(),
      url: z.string(),
      version: z.number().int().nullable(),
      // An upload's position in its message's attachments.
      attachmentIndex: z.number().int().nullable(),
      authorName: z.string(),
      updatedAt: z.string(),
      conversation: getArtifactResponseSchema.shape.conversation,
    })
  ),
  nextCursor: z.string().nullable(),
})
