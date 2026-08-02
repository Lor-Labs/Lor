import { z } from "@hono/zod-openapi"
import {
  agentRunEventKindEnum,
  agentRunPhaseEnum,
  agentRunStateEnum,
  agentRunStopReasonEnum,
} from "@repo/db/schema"

export const runEventsParamsSchema = z.object({
  messageId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "messageId", in: "path", required: true },
    }),
})

export const runEventsQuerySchema = z.object({
  // Return only events with seq greater than this (the client's replay
  // high-water mark). Omit for the full log.
  after: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .openapi({
      param: { name: "after", in: "query", required: false },
    }),
})

const toolCallSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  label: z.string(),
  parentToolCallId: z.string().optional(),
  at: z.number().optional(),
  order: z.number().optional(),
  detail: z
    .object({
      summary: z.string().optional(),
      items: z
        .array(z.object({ title: z.string(), url: z.string().optional() }))
        .optional(),
    })
    .optional(),
  status: z.enum(["ok", "error"]).optional(),
})

// Mirrors AgentRunEventPayload in @repo/db/schema (zod needed for OpenAPI).
export const runEventPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    delta: z.string(),
    replace: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("reasoning"),
    delta: z.string(),
    at: z.number(),
    order: z.number(),
  }),
  z.object({ kind: z.literal("tool"), toolCall: toolCallSchema }),
  z.object({
    kind: z.literal("memory"),
    path: z.string(),
    action: z.enum(["created", "updated"]),
  }),
  z.object({
    kind: z.literal("state"),
    state: z.enum(agentRunStateEnum.enumValues),
    phase: z.enum(agentRunPhaseEnum.enumValues).optional(),
    stopReason: z.enum(agentRunStopReasonEnum.enumValues).optional(),
  }),
  z.object({
    kind: z.literal("steer"),
    messageId: z.string(),
    authorName: z.string(),
  }),
  z.object({ kind: z.literal("queued"), messageId: z.string() }),
  z.object({ kind: z.literal("truncate"), contentLength: z.number() }),
])

export const stopRunResponseSchema = z.object({
  state: z.enum(agentRunStateEnum.enumValues),
  // True when the run was settled immediately (never claimed); false when the
  // lease holder will honor the request at its next step boundary.
  stopped: z.boolean(),
})

export const runEventsResponseSchema = z.object({
  run: z.object({
    id: z.string().uuid(),
    messageId: z.string().uuid(),
    channelId: z.string().uuid(),
    threadRootId: z.string().uuid().nullable(),
    state: z.enum(agentRunStateEnum.enumValues),
    stopReason: z.enum(agentRunStopReasonEnum.enumValues).nullable(),
  }),
  events: z.array(
    z.object({
      seq: z.number().int(),
      kind: z.enum(agentRunEventKindEnum.enumValues),
      payload: runEventPayloadSchema,
    })
  ),
})
