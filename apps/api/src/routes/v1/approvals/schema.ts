import { z } from "@hono/zod-openapi"
import { approvalResolverKindEnum, approvalStatusEnum } from "@repo/db/schema"

export const approvalParamsSchema = z.object({
  approvalId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "approvalId", in: "path", required: true },
    }),
})

export const approvalSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid().nullable(),
  action: z.string(),
  description: z.string(),
  status: z.enum(approvalStatusEnum.enumValues),
  // Set for policy-gated tool calls (LOR-81); null when the agent asked for a
  // one-off approval itself.
  target: z.string().nullable(),
  toolName: z.string().nullable(),
  resolvedBy: z.string().uuid().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const resolveApprovalResponseSchema = z.object({
  approval: approvalSchema,
})

export const channelApprovalsParamsSchema = z.object({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
    }),
})

// A session's approvals in any state, so each card shows how it was resolved;
// without it, the channel's pending ones.
export const channelApprovalsQuerySchema = z.object({
  threadRootId: z.string().uuid().optional(),
})

export const approvalResolverSchema = z.object({
  kind: z.enum(approvalResolverKindEnum.enumValues),
  role: z.string().optional(),
  userId: z.string().uuid().optional(),
})

// The harness questions tool's answer shape: per question id, the picked
// option ids and any written answer.
const claudeCodeAnswersSchema = z.record(
  z.string().max(100),
  z.object({
    optionIds: z.array(z.string().max(100)).max(20),
    freeform: z.string().max(4000).optional(),
  })
)

// A Claude Code question as the card shows it (the harness questions input).
const claudeCodeQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  header: z.string().optional(),
  options: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string().optional(),
      })
    )
    .optional(),
  allowMultiple: z.boolean().optional(),
})

// A pending gate anchored to the message whose run parked — what the chat
// surfaces render a card under. resolver null = owner-only (dangling named
// resolver); resolverUserName is display sugar for the user kind.
export const channelApprovalSchema = approvalSchema.extend({
  channelId: z.string().uuid(),
  threadRootId: z.string().uuid().nullable(),
  messageId: z.string().uuid().nullable(),
  resolver: approvalResolverSchema.nullable(),
  resolverUserName: z.string().nullable(),
  // A Claude Code prompt: only this person, the turn's sender, decides it
  // (the workspace owner too waits on them).
  onlyUserId: z.string().uuid().nullable(),
  // A Claude Code plan waiting for approval (ExitPlanMode): its Markdown.
  plan: z.string().nullable(),
  // A Claude Code question (askUserQuestions): its questions, and once
  // answered, the answers.
  questions: z.array(claudeCodeQuestionSchema).nullable(),
  answers: claudeCodeAnswersSchema.nullable(),
})

// Approving a Claude Code plan: the mode the turn goes on in, as in Claude
// Code's own plan dialog ("accept edits" or "ask for edits").
export const approvePlanBodySchema = z.object({
  mode: z.enum(["acceptEdits", "default"]),
})

// Answering a Claude Code question (askUserQuestions).
export const answerApprovalBodySchema = z.object({
  answers: claudeCodeAnswersSchema,
})

export const listChannelApprovalsResponseSchema = z.object({
  approvals: z.array(channelApprovalSchema),
})
