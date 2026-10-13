import { z } from "@hono/zod-openapi"
import { workspaceSlugParamsSchema } from "@/routes/v1/channels/schema"

export { workspaceSlugParamsSchema }

// ── Path Params ──────────────────────────────────────────

export const inviteCodeParamsSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(12)
    .openapi({
      param: {
        name: "code",
        in: "path",
        required: true,
      },
      example: "aBc4xZ7q",
    }),
})

export const workspaceInviteCodeParamsSchema = workspaceSlugParamsSchema.extend(
  {
    code: z
      .string()
      .min(1)
      .max(12)
      .openapi({
        param: {
          name: "code",
          in: "path",
          required: true,
        },
        example: "aBc4xZ7q",
      }),
  }
)

export const invitationIdParamsSchema = z.object({
  invitationId: z
    .string()
    .uuid()
    .openapi({
      param: {
        name: "invitationId",
        in: "path",
        required: true,
      },
      example: "c1b5e0f4-8a1d-4b6e-9f2a-3d7c8e9f0a1b",
    }),
})

export const invitationPreviewQuerySchema = z.object({
  sig: z
    .string()
    .min(1)
    .openapi({
      param: {
        name: "sig",
        in: "query",
        required: true,
      },
    }),
})

// ── Request Schemas ──────────────────────────────────────

export const createInviteRequestSchema = z.object({
  channelId: z.string().uuid().nullable().optional(),
  maxUses: z.number().int().min(1).max(1000).nullable().optional(),
  expiresInMinutes: z
    .number()
    .int()
    .min(30)
    .max(60 * 24 * 7) // max 7 days
    .nullable()
    .optional(),
})

// ── Response Schemas ──────────────────────────────────────

export const workspaceInviteSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  workspaceId: z.string().uuid(),
  inviterId: z.string().uuid(),
  channelId: z.string().uuid().nullable(),
  maxUses: z.number().nullable(),
  uses: z.number(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  inviter: z.object({
    name: z.string(),
    image: z.string().nullable(),
  }),
})

export const createInviteResponseSchema = z.object({
  success: z.literal(true),
  invite: workspaceInviteSchema,
})

export const listInvitesResponseSchema = z.object({
  success: z.literal(true),
  invites: z.array(workspaceInviteSchema),
})

export const deleteInviteResponseSchema = z.object({
  success: z.literal(true),
})

export const invitePreviewSchema = z.object({
  code: z.string(),
  workspace: z.object({
    name: z.string(),
    slug: z.string(),
    logo: z.string().nullable(),
    memberCount: z.number(),
  }),
  channel: z
    .object({
      id: z.string().uuid(),
      name: z.string().nullable(),
    })
    .nullable(),
  inviter: z.object({
    name: z.string(),
    image: z.string().nullable(),
  }),
  isExpired: z.boolean(),
  isMember: z.boolean(),
})

export const invitePreviewResponseSchema = z.object({
  success: z.literal(true),
  invite: invitePreviewSchema,
})

export const invitationPreviewResponseSchema = z.object({
  success: z.literal(true),
  invitation: z.object({
    id: z.string().uuid(),
    email: z.string(),
    workspace: z.object({
      name: z.string(),
      slug: z.string(),
      logo: z.string().nullable(),
      memberCount: z.number(),
    }),
    inviter: z.object({
      name: z.string(),
      image: z.string().nullable(),
    }),
    // Not pending (accepted, canceled, rejected) or past its expiry
    isExpired: z.boolean(),
    // The invite page picks sign-in or sign-up from this
    hasAccount: z.boolean(),
    isMember: z.boolean(),
  }),
})

export const acceptInviteResponseSchema = z.object({
  success: z.literal(true),
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
  }),
})
