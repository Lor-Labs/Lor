import { z } from "@hono/zod-openapi"
import {
  changeOperationKindEnum,
  changeOperationSchema,
  changeProposalStatusEnum,
  proposalEvidenceSchema,
} from "@repo/db/schema"

export const proposalParamsSchema = z.object({
  proposalId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "proposalId", in: "path", required: true },
    }),
})

export const channelProposalsParamsSchema = z.object({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
    }),
})

export const proposalOperationSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int(),
  kind: z.enum(changeOperationKindEnum.enumValues),
  spec: changeOperationSchema,
  result: z
    .object({
      resourceId: z.string().optional(),
      url: z.string().optional(),
      setupNote: z.string().optional(),
    })
    .nullable(),
  error: z.string().nullable(),
})

export const changeProposalSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  cardMessageId: z.string().uuid().nullable(),
  authorType: z.enum(["user", "agent"]),
  authorUserId: z.string().uuid().nullable(),
  rationale: z.string(),
  evidence: z.array(proposalEvidenceSchema),
  status: z.enum(changeProposalStatusEnum.enumValues),
  resolvedByUserId: z.string().uuid().nullable(),
  resolvedAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: z.string(),
  operations: z.array(proposalOperationSchema),
  // Union of manage permissions the ops touch — what an approver must hold;
  // clients mirror the gate with this instead of recomputing from specs.
  requiredPermissions: z.record(z.string(), z.array(z.string())),
})

export const getProposalResponseSchema = z.object({
  proposal: changeProposalSchema,
})

export const listChannelProposalsResponseSchema = z.object({
  proposals: z.array(changeProposalSchema),
})

export const rejectProposalRequestSchema = z.object({
  note: z.string().trim().max(2000).optional(),
})

export const rejectProposalResponseSchema = z.object({
  proposal: changeProposalSchema,
})
