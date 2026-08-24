import { z } from "@hono/zod-openapi"
import {
  agentRunStateEnum,
  agentRunStopReasonEnum,
  loopPausedReasonEnum,
  loopStatusEnum,
  taskStatusEnum,
} from "@repo/db/schema"
import { artifactSchema } from "@/routes/v1/artifacts/schema"

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

export const updateLoopBodySchema = z.object({
  // Cron expression from the panel's structured editor. Draft-only for now;
  // editing active loops (with high-frequency re-confirm) is L3.
  schedule: z.string().min(1).max(120),
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

// One scheduled run in the loop's history: outcome, the closing note the run
// left for its successor, and what it spawned (tasks/artifacts by originRunId).
export const loopRunSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(agentRunStateEnum.enumValues),
  stopReason: z.enum(agentRunStopReasonEnum.enumValues).nullable(),
  scheduledFor: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  note: z.string().nullable(),
  creditsSpent: z.number().int(),
  // Distinct side-effecting tools the run executed — the mechanical account
  // that survives a run dying before it wrote a note.
  effects: z.array(z.string()),
  tasks: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      status: z.enum(taskStatusEnum.enumValues),
      cardMessageId: z.string().uuid().nullable(),
    })
  ),
  artifacts: z.array(artifactSchema),
})

export const listLoopRunsResponseSchema = z.object({
  runs: z.array(loopRunSchema),
})
