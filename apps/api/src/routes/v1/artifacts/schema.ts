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

export const taskArtifactsParamsSchema = z.object({
  taskId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "taskId", in: "path", required: true },
    }),
})

export const artifactSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  channelId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
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
  // Newest first.
  versions: z.array(artifactVersionSchema),
})

export const listTaskArtifactsResponseSchema = z.object({
  artifacts: z.array(artifactSchema),
})
