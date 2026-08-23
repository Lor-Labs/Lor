import { z } from "@hono/zod-openapi"

export const workspaceSlugParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: {
      name: "workspaceSlug",
      in: "path",
      required: true,
    },
    example: "my-workspace",
  }),
})

export const projectParamsSchema = workspaceSlugParamsSchema.extend({
  projectId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "projectId", in: "path", required: true },
      example: "00000000-0000-0000-0000-000000000000",
    }),
})

export const projectMemberParamsSchema = projectParamsSchema.extend({
  userId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "userId", in: "path", required: true },
      example: "00000000-0000-0000-0000-000000000000",
    }),
})

// ── Create ──────────────────────────────────────────

export const createProjectRequestSchema = z.object({
  name: z.string().min(1).max(100),
  // Linear-aligned: optional; a linked Linear project can autofill it later.
  description: z.string().max(2000).optional(),
  targetDate: z.string().datetime().optional(),
  // "members" (default) = private to the selected members; "workspace" = a
  // public project everyone can see.
  audience: z.enum(["workspace", "members"]).default("members"),
  memberIds: z.array(z.string().uuid()).max(200).default([]),
  channels: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        type: z.enum(["text", "voice"]).default("text"),
      })
    )
    .min(1)
    .max(20)
    .default([{ name: "general", type: "text" }]),
})

// ── Responses ──────────────────────────────────────────

export const projectSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  categoryChannelId: z.string().uuid(),
  creatorId: z.string().uuid(),
  // Lives on the category channel — one source of truth for the sidebar.
  name: z.string(),
  description: z.string().nullable(),
  targetDate: z.string().nullable(),
  audience: z.enum(["workspace", "members"]),
  status: z.enum(["active", "archiving", "archived"]),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const projectMemberSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  username: z.string().nullable(),
  displayUsername: z.string().nullable(),
  image: z.string().nullable(),
})

export const projectChannelSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  type: z.enum(["text", "voice"]),
  archivedAt: z.string().nullable(),
})

// A brain page saved by archive synthesis — the overview's "saved to
// memory" glance. nodeId references the brain node durably (paths can go
// stale); optional for rows written before it existed.
export const projectMemorySchema = z.object({
  path: z.string(),
  action: z.enum(["created", "updated"]),
  nodeId: z.string().uuid().optional(),
})

export const projectDetailSchema = projectSchema.extend({
  summary: z.string().nullable(),
  memories: z.array(projectMemorySchema),
  members: z.array(projectMemberSchema),
  channels: z.array(projectChannelSchema),
})

export const listProjectsResponseSchema = z.object({
  projects: z.array(projectSchema),
})

export const updateProjectRequestSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(2000).nullable().optional(),
    targetDate: z.string().datetime().nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "At least one project field must be provided",
    }
  )

export const addProjectMemberRequestSchema = z.object({
  userId: z.string().uuid(),
})

export const successResponseSchema = z.object({
  success: z.literal(true),
})
