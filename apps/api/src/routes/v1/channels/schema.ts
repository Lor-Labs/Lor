import { z } from "@hono/zod-openapi"
import {
  insertChannelSchema,
  integrationProviderEnum,
  selectChannelSchema,
  updateChannelSchema,
} from "@repo/db/schema"
import {
  listMessagesQuerySchema,
  listMessagesResponseSchema,
  messageWithAuthorSchema,
  threadParticipantSchema,
} from "@/lib/helpers/openapi/message-schemas"

// ── Path Params ──────────────────────────────────────────

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

export const channelParamsSchema = workspaceSlugParamsSchema.extend({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
      example: "00000000-0000-0000-0000-000000000000",
    }),
})

export const channelResponseSchema = selectChannelSchema

export const channelReadPositionResponseSchema = z.object({
  firstUnreadMessageId: z.string().uuid().nullable(),
})

export const categoryWithChannelsSchema = selectChannelSchema.extend({
  channels: z.array(selectChannelSchema),
})

export const listChannelsResponseSchema = z.object({
  uncategorized: z.array(selectChannelSchema),
  categories: z.array(categoryWithChannelsSchema),
})

// Narrow the create endpoint to workspace-creatable types only.
// DMs / group DMs are created via the /dms route, not generic create-channel.
// `audience`/`memberIds` create a standalone private channel (same membership
// mechanics as a project, minus the lifecycle row).
export const createChannelRequestSchema = insertChannelSchema.extend({
  type: z.enum(["text", "voice", "category"]).default("text"),
  audience: z.enum(["workspace", "members"]).default("workspace"),
  memberIds: z.array(z.string().uuid()).max(200).optional(),
})

export const createChannelResponseSchema = selectChannelSchema

// ── Update / Delete ──────────────────────────────────────────

const updateChannelRequestBaseSchema = updateChannelSchema
  .pick({
    name: true,
    topic: true,
    rateLimitPerUser: true,
    agentProfileId: true,
  })
  .strict()

export const updateChannelRequestSchema = updateChannelRequestBaseSchema.refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  {
    message: "At least one channel field must be provided",
  }
)

export const updateChannelResponseSchema = selectChannelSchema

export const deleteChannelResponseSchema = z.object({
  success: z.literal(true),
})

// ── Messages ──────────────────────────────────────────

export {
  messageWithAuthorSchema,
  listMessagesQuerySchema,
  listMessagesResponseSchema,
}

// Thread replies also carry the root message itself, so the panel can render
// it even when the root has scrolled out of the channel feed (e.g. a thread
// reopened from the URL on refresh).
export const listThreadRepliesResponseSchema =
  listMessagesResponseSchema.extend({
    root: messageWithAuthorSchema.nullable(),
    participants: z.array(threadParticipantSchema),
  })

// ── Pins ──────────────────────────────────────────

export const messageIdParamsSchema = channelParamsSchema.extend({
  messageId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "messageId", in: "path", required: true },
      example: "00000000-0000-0000-0000-000000000000",
    }),
})

export const togglePinResponseSchema = z.object({
  success: z.literal(true),
  pinned: z.boolean(),
})

// ── Message location (jump-to-message) ──────────────────────────────────────

export const messageLocationParamsSchema = workspaceSlugParamsSchema.extend({
  messageId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "messageId", in: "path", required: true },
      example: "00000000-0000-0000-0000-000000000000",
    }),
})

export const messageLocationResponseSchema = z.object({
  messageId: z.string().uuid(),
  channelId: z.string().uuid(),
  threadRootId: z.string().uuid().nullable(),
})

export const listPinnedMessagesResponseSchema = z.object({
  data: z.array(messageWithAuthorSchema),
})

// ── Thread activity (unread thread replies surfaced at feed bottom) ──────────

const threadActivityMentionSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
})

export const threadActivityItemSchema = z.object({
  threadRootId: z.string().uuid(),
  replyCount: z.number().int(),
  newReplyCount: z.number().int(),
  lastReplyAt: z.string(),
  participants: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      image: z.string().nullable(),
    })
  ),
  lastReply: z.object({
    content: z.string().nullable(),
    author: z.object({
      id: z.string(),
      name: z.string(),
      image: z.string().nullable(),
    }),
    hasAttachments: z.boolean(),
    mentions: z.array(threadActivityMentionSchema),
  }),
})

export const listThreadActivityResponseSchema = z.object({
  data: z.array(threadActivityItemSchema),
})

export const threadReadParamsSchema = channelParamsSchema.extend({
  threadRootId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "threadRootId", in: "path", required: true },
      example: "00000000-0000-0000-0000-000000000000",
    }),
})

export const markThreadReadResponseSchema = z.object({
  success: z.literal(true),
  lastReadAt: z.string(),
})

// ── Reorder ──────────────────────────────────────────

export const reorderChannelItemSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().min(0),
  parentId: z.string().uuid().nullable(),
})

export const reorderChannelsRequestSchema = z.object({
  channels: z.array(reorderChannelItemSchema).min(1),
})

export const reorderChannelsResponseSchema = z.object({
  success: z.literal(true),
})

// ── Connectors ──────────────────────────────────────────

export const channelConnectorParamsSchema = channelParamsSchema.extend({
  provider: z.enum(integrationProviderEnum.enumValues).openapi({
    param: { name: "provider", in: "path", required: true },
  }),
})

export const listChannelConnectorsResponseSchema = z.object({
  connectors: z.array(
    z.object({
      id: z.enum(integrationProviderEnum.enumValues),
      label: z.string(),
      supportsFiles: z.boolean(),
    })
  ),
})

export const listConnectorScopesResponseSchema = z.object({
  // The containers a connector's files live in (GitHub repositories).
  scopes: z.array(z.object({ id: z.string(), label: z.string() })),
})

export const connectorSearchQuerySchema = z.object({
  // Empty is valid: connectors that can list recent records return those.
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(15).optional(),
})

export const connectorFilesQuerySchema = connectorSearchQuerySchema.extend({
  // The container to browse — a GitHub repo as "owner/repo".
  scope: z.string().min(1),
})

export const connectorSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      subtitle: z.string().nullable(),
      url: z.string(),
    })
  ),
})
