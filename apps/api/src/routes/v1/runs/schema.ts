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
  at: z.number().optional(),
  order: z.number().optional(),
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
    nodeId: z.string().uuid().optional(),
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
  // lease holder aborts the in-flight request on the stop signal.
  stopped: z.boolean(),
})

export const removeQueuedResponseSchema = z.object({
  removed: z.boolean(),
})

export const threadContextParamsSchema = z.object({
  scopeKey: z
    .string()
    .uuid()
    .openapi({
      param: { name: "scopeKey", in: "path", required: true },
    }),
})

// What the model actually received on its last request in this scope, plus
// how that total is made up. `usedTokens` is exact (reported by the provider
// and checkpointed); the segments are byte-derived estimates scaled to it, so
// the breakdown shows honest proportions of a real total.
export const threadContextResponseSchema = z.object({
  available: z.boolean(),
  usedTokens: z.number().int(),
  windowTokens: z.number().int(),
  compactAtTokens: z.number().int(),
  segments: z.object({
    system: z.number().int(),
    tools: z.number().int(),
    messages: z.number().int(),
  }),
  // A Claude Code session: Claude Code's own counted rows replace the
  // estimated segments (which are then zero).
  categories: z
    .array(z.object({ name: z.string(), tokens: z.number().int() }))
    .nullable(),
  compacted: z.boolean(),
  // Tokens the whole thread's transcript would weigh uncompacted — the
  // headline for what compaction bought.
  rawHistoryTokens: z.number().int(),
  // Null for a Claude Code session: its turns spend no Lor credits.
  creditsSpent: z.number().int().nullable(),
  runCount: z.number().int(),
  state: z.enum(agentRunStateEnum.enumValues).nullable(),
})

export const runEventsResponseSchema = z.object({
  nextCursor: z.number().int().nullable(),
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
  // Messages waiting in the run's scope queue (oldest first) — the thread
  // composer's queued pill rebuilds from this on late join. The messages
  // themselves are ordinary thread replies the client already has.
  queue: z.array(
    z.object({
      messageId: z.string().uuid(),
      senderId: z.string(),
    })
  ),
})
