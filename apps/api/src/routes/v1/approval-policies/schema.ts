import { z } from "@hono/zod-openapi"
import { approvalResolverKindEnum } from "@repo/db/schema"

export const approvalPoliciesParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})

export const approvalPolicyIdParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
  policyId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "policyId", in: "path", required: true },
    }),
})

const resolverKindSchema = z.enum(approvalResolverKindEnum.enumValues)

export const approvalPolicySchema = z.object({
  id: z.string().uuid(),
  target: z.string(),
  resolverKind: resolverKindSchema,
  resolverRole: z.string().nullable(),
  resolverUserId: z.string().uuid().nullable(),
})

// One row per switch on the policy page, computed from the registry plus this
// workspace's custom tools and MCP servers — the overlay of policy rows on it
// is what the UI renders.
export const approvalTargetSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  group: z.enum(["capability", "custom_tool", "mcp_server"]),
})

export const listApprovalPoliciesResponseSchema = z.object({
  policies: z.array(approvalPolicySchema),
  targets: z.array(approvalTargetSchema),
})

export const upsertApprovalPolicyRequestSchema = z
  .object({
    target: z.string().min(1).max(200),
    resolverKind: resolverKindSchema,
    resolverRole: z.string().min(1).max(100).optional(),
    resolverUserId: z.string().uuid().optional(),
  })
  .refine((body) => body.resolverKind !== "role" || !!body.resolverRole, {
    message: "resolverRole is required when resolverKind is role",
  })
  .refine((body) => body.resolverKind !== "user" || !!body.resolverUserId, {
    message: "resolverUserId is required when resolverKind is user",
  })

export const upsertApprovalPolicyResponseSchema = z.object({
  policy: approvalPolicySchema,
})

export const deleteApprovalPolicyResponseSchema = z.object({
  success: z.literal(true),
})
