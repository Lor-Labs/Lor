import { z } from "@hono/zod-openapi"
import { loopPausedReasonEnum, loopStatusEnum } from "@repo/db/schema"

export const channelLoopsParamsSchema = z.object({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
    }),
})

export const loopParamsSchema = z.object({
  loopId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "loopId", in: "path", required: true },
    }),
})

export const activateLoopBodySchema = z.object({
  // The tz to pin on the row — clients default it to the device timezone
  // (drafts may carry null = "not pinned yet"). Always required here so an
  // active loop never computes fires in an ambiguous zone.
  timezone: z.string().min(1).max(64),
  // Sub-hourly cadences are a recurring cost; the server refuses them with
  // requires_confirmation until the activator explicitly opts in.
  confirmHighFrequency: z.boolean().optional(),
})

// Mirrors RealtimeLoop (packages/realtime-types) — the same snapshot the
// loop:updated event carries, so the card renders identically from either.
export const loopSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  channelId: z.string().uuid(),
  cardMessageId: z.string().uuid().nullable(),
  creatorId: z.string().uuid().nullable(),
  name: z.string(),
  instructions: z.string(),
  schedule: z.string(),
  timezone: z.string().nullable(),
  endCondition: z.string().nullable(),
  status: z.enum(loopStatusEnum.enumValues),
  pausedReason: z.enum(loopPausedReasonEnum.enumValues).nullable(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  consecutiveFailures: z.number(),
  completedNote: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const listChannelLoopsResponseSchema = z.object({
  loops: z.array(loopSchema),
})

export const activateLoopResponseSchema = z.object({
  loop: loopSchema,
})

// 422 payload for a sub-hourly schedule the activator hasn't confirmed yet —
// distinct code so clients show the confirm dialog rather than an error.
export const requiresConfirmationResponseSchema = z.object({
  success: z.literal(false),
  code: z.literal("requires_confirmation"),
  message: z.string(),
  // Approximate fires per day at the schedule's tightest gap, for the dialog.
  firesPerDay: z.number(),
})
