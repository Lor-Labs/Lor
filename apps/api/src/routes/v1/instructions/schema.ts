import { z } from "@hono/zod-openapi"
import {
  workspaceInstructionsAuthorEnum,
  workspaceInstructionsStateEnum,
} from "@repo/db/schema"

export const instructionsWorkspaceParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})

export const instructionsVersionParamsSchema =
  instructionsWorkspaceParamsSchema.extend({
    version: z.coerce
      .number()
      .int()
      .positive()
      .openapi({ param: { name: "version", in: "path", required: true } }),
  })

export const instructionsVersionSchema = z.object({
  version: z.number().int(),
  content: z.string(),
  state: z.enum(workspaceInstructionsStateEnum.enumValues),
  authorType: z.enum(workspaceInstructionsAuthorEnum.enumValues),
  authorName: z.string().nullable(),
  baseVersion: z.number().int().nullable(),
  rationale: z.string().nullable(),
  createdAt: z.string(),
})

export const getInstructionsResponseSchema = z.object({
  active: instructionsVersionSchema.nullable(),
  pending: instructionsVersionSchema.nullable(),
  versions: z.array(instructionsVersionSchema),
  canManage: z.boolean(),
})

export const updateInstructionsRequestSchema = z.object({
  content: z.string(),
  // The active version this edit was written against (null = no active yet);
  // a mismatch means someone else changed it first — 409, never silent merge.
  baseVersion: z.number().int().positive().nullable(),
})

export const updateInstructionsResponseSchema = z.object({
  success: z.literal(true),
  active: instructionsVersionSchema,
})

export const resolveProposalResponseSchema = z.object({
  success: z.literal(true),
})
