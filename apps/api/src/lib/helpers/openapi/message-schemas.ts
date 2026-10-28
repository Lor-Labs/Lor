import { z } from "@hono/zod-openapi"
import type { ChannelEventPayload, ForwardedMessage } from "@repo/db/schema"
import { selectMessageSchema } from "@repo/db/schema"

export const messageAuthorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  image: z.string().nullable(),
  avatarColor: z.string().nullable().optional(),
})

export const messageReactionSchema = z.object({
  emoji: z.string(),
  count: z.number().int().nonnegative(),
  reactedByCurrentUser: z.boolean(),
  reactors: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
    })
  ),
})

const httpsUrlSchema = z.string().regex(/^https?:\/\//i)

export const messageEmbedSchema = z.object({
  type: z.enum(["link", "image", "video", "rich"]),
  // Optional for "rich" (webhook cards can be link-less).
  url: httpsUrlSchema.optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  eventLabel: z.string().optional(),
  thumbnail: httpsUrlSchema.optional(),
  siteName: z.string().optional(),
  // Rich (webhook-card) extras — Discord embeds / Slack attachments.
  author: z
    .object({
      name: z.string(),
      url: httpsUrlSchema.optional(),
      iconUrl: httpsUrlSchema.optional(),
    })
    .optional(),
  fields: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        inline: z.boolean().optional(),
      })
    )
    .optional(),
  image: z.string().optional(),
  footer: z.string().optional(),
  timestamp: z.string().optional(),
  color: z.string().optional(),
  meeting: z
    .object({
      recordingId: z.string(),
      meetingId: z.string(),
      durationMinutes: z.number(),
      participants: z.array(z.string()),
      transcript: z.string(),
      transcriptTruncated: z.boolean(),
      summary: z.string().optional(),
      followUps: z.array(z.object({ label: z.string(), prompt: z.string() })),
    })
    .optional(),
})

export const lorToolCallSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  label: z.string(),
  at: z.number().optional(),
  order: z.number().int().nonnegative().optional(),
  detail: z
    .object({
      summary: z.string().optional(),
      items: z
        .array(
          z.object({
            title: z.string(),
            url: z.string().optional(),
            favicon: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
  diff: z
    .object({
      path: z.string(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
      patch: z.string().optional(),
      truncated: z.boolean().optional(),
    })
    .optional(),
  files: z
    .array(
      z.object({
        artifactId: z.string(),
        path: z.string(),
        contentType: z.string(),
        size: z.number(),
        url: z.string(),
      })
    )
    .optional(),
  status: z.enum(["ok", "error"]).optional(),
})

export const lorReasoningSegmentSchema = z.object({
  text: z.string(),
  at: z.number().int().nonnegative(),
  order: z.number().int().nonnegative(),
})

export const lorMemorySchema = z.object({
  path: z.string(),
  action: z.enum(["created", "updated"]),
  // Durable brain-node reference; rows persisted before it existed omit it.
  nodeId: z.string().uuid().optional(),
})

export const referencedMessageSchema = z
  .object({
    id: z.string().uuid(),
    content: z.string().nullable(),
    author: messageAuthorSchema,
    overrideName: z.string().nullable(),
    overrideAvatarUrl: z.string().nullable(),
    // Lets reply previews resolve stored `<@uuid>` mention tokens in `content`.
    // Optional so endpoints that don't join mentions stay valid.
    mentions: z.array(messageAuthorSchema).optional(),
  })
  .nullable()

export const threadParticipantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  image: z.string().nullable(),
  avatarColor: z.string().nullable().optional(),
})

export const threadSummarySchema = z
  .object({
    replyCount: z.number().int().nonnegative(),
    lastReplyAt: z.string(),
    participants: z.array(threadParticipantSchema),
  })
  .nullable()

export const messageWithAuthorSchema = selectMessageSchema
  // Raw memory column is reshaped into `remembered` below; the memory
  // exclusion flag, send-idempotency key, Claude Code mode and the turn's
  // model, effort and fast mode are plumbing the client never needs.
  .omit({
    lorMemories: true,
    excludedFromMemory: true,
    clientKey: true,
    claudeCodeMode: true,
    turnModel: true,
    turnEffort: true,
    turnFast: true,
  })
  .extend({
    author: messageAuthorSchema,
    // Typed passthrough — keeps the inferred client type as the payload union
    // instead of drizzle-zod's loose jsonb shape.
    eventPayload: z.custom<ChannelEventPayload | null>(),
    // type "forward": the original as it was when forwarded.
    forwarded: z.custom<ForwardedMessage | null>(),
    mentions: z.array(messageAuthorSchema),
    reactions: z.array(messageReactionSchema),
    embeds: z.array(messageEmbedSchema),
    referencedMessage: referencedMessageSchema,
    threadSummary: threadSummarySchema,
    // Only Lor replies carry these; optional so other message endpoints
    // (DMs, pinned, …) need not supply them.
    lorToolCalls: z.array(lorToolCallSchema).optional(),
    lorReasoningSegments: z.array(lorReasoningSegmentSchema).optional(),
    remembered: z.array(lorMemorySchema).optional(),
    lorTriggerMessageId: z.string().uuid().nullable().optional(),
  })

// Cursor-based query: `around`, `before`, `after` are mutually exclusive
// message ids. With none, the latest page is returned.
export const listMessagesQuerySchema = z
  .object({
    around: z.string().uuid().optional(),
    before: z.string().uuid().optional(),
    after: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine((value, ctx) => {
    const cursors = [value.around, value.before, value.after].filter(
      (v) => v !== undefined
    )
    if (cursors.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "`around`, `before`, and `after` are mutually exclusive — provide at most one",
        path: ["around"],
      })
    }
  })

export const listMessagesResponseSchema = z.object({
  data: z.array(messageWithAuthorSchema),
  beforeCursor: z.string().uuid().nullable(),
  afterCursor: z.string().uuid().nullable(),
  reachedOldest: z.boolean(),
  reachedNewest: z.boolean(),
})
