import { z } from "@hono/zod-openapi"

export const voiceChannelParamsSchema = z.object({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
    }),
})

export const voiceSessionParamsSchema = z.object({
  sessionId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "sessionId", in: "path", required: true },
    }),
})

export const leaveVoiceSessionResponseSchema = z.object({
  success: z.literal(true),
})

export const joinVoiceChannelResponseSchema = z.object({
  url: z.string(),
  token: z.string(),
  sessionId: z.string().uuid(),
  participantId: z.string().uuid(),
})

export const voiceCallResponseSchema = z.object({
  call: z
    .object({
      sessionId: z.string().uuid(),
      channelId: z.string().uuid(),
      channelName: z.string().nullable(),
      workspaceId: z.string().uuid(),
      workspaceSlug: z.string(),
    })
    .nullable(),
})

export const workspaceSlugParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
    example: "my-workspace",
  }),
})

export const voiceSessionHistoryQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

const voiceParticipantSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  image: z.string().nullable(),
  avatarColor: z.string().nullable(),
  connected: z.boolean(),
})

const voiceSessionSummarySchema = z.object({
  id: z.string().uuid(),
  threadRootId: z.string().uuid().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  live: z.boolean(),
  replyCount: z.number().int(),
  participants: z.array(voiceParticipantSchema),
})

export const voiceSessionHistoryResponseSchema = z.object({
  sessions: z.array(voiceSessionSummarySchema),
  nextBefore: z.string().datetime().nullable(),
})

export const voiceSessionDetailResponseSchema = z.object({
  channelId: z.string().uuid(),
  session: voiceSessionSummarySchema,
})

export const voicePresenceResponseSchema = z.object({
  channels: z.array(
    z.object({
      channelId: z.string().uuid(),
      sessionId: z.string().uuid(),
      participants: z.array(voiceParticipantSchema),
    })
  ),
})
