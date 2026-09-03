import { relations } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { z } from "zod"
import { channel } from "./channels"
import { message } from "./messages"
import { user } from "./users"
import { workspace } from "./workspaces"

// Workspace change-proposal vocabulary (pillar 3, reference/change-proposals.md).
// A proposal is an ordered list of typed operations a human approves as one
// unit. These schemas are the shared contract between the propose tool
// (packages/merlin), the proposal rows (@repo/db $type), and the apply engine
// (apps/api) — shape validation lives here, deep validation (ownership, name
// collisions, SSRF, cron) happens at apply time exactly like the real handlers.

// A resource an operation targets: one that already exists, or one another
// operation in the SAME proposal creates (referenced by its position).
export const resourceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), id: z.string().uuid() }),
  z.object({
    kind: z.literal("created"),
    opPosition: z.number().int().min(0),
  }),
])
export type ResourceRef = z.infer<typeof resourceRefSchema>

export const createChannelOpSchema = z.object({
  op: z.literal("create_channel"),
  name: z.string().trim().min(1).max(100),
  topic: z.string().trim().max(1024).nullable().default(null),
})

export const createWebhookOpSchema = z.object({
  op: z.literal("create_webhook"),
  channel: resourceRefSchema,
  name: z.string().trim().min(1).max(80),
})

// Routes a connector event into a channel (upsert on connection+event).
// Deleting a route is deliberately not proposable.
export const setTriggerOpSchema = z.object({
  op: z.literal("set_trigger"),
  connectionId: z.string().uuid(),
  event: z.string().min(1).max(100),
  channel: resourceRefSchema,
  post: z.boolean().default(true),
  remember: z.boolean().default(false),
  rememberHint: z.string().trim().max(2000).nullable().default(null),
  actInstructions: z.string().trim().max(4000).nullable().default(null),
})

const loopEndAfterSchema = z.object({
  amount: z.number().int().min(1).max(365),
  unit: z.enum(["days", "weeks", "months"]),
})

export const createLoopOpSchema = z.object({
  op: z.literal("create_loop"),
  channel: resourceRefSchema,
  name: z.string().trim().min(1).max(100),
  instructions: z.string().trim().min(1).max(8000),
  // 5-field cron; validated with the real scheduler at apply.
  schedule: z.string().trim().min(1).max(100),
  timezone: z.string().trim().max(64).nullable().default(null),
  endCondition: z.string().trim().max(1000).nullable().default(null),
  endAfter: loopEndAfterSchema.nullable().default(null),
})

export const updateLoopOpSchema = z.object({
  op: z.literal("update_loop"),
  loopId: z.string().uuid(),
  name: z.string().trim().min(1).max(100).optional(),
  instructions: z.string().trim().min(1).max(8000).optional(),
  schedule: z.string().trim().min(1).max(100).optional(),
  timezone: z.string().trim().max(64).nullable().optional(),
  endCondition: z.string().trim().max(1000).nullable().optional(),
})

// Full replacement content, like the human PUT. Applying the proposal IS the
// human approval — no second pending instructions version is created.
export const updateInstructionsOpSchema = z.object({
  op: z.literal("update_instructions"),
  content: z.string().min(1).max(20000),
})

export const createAgentProfileOpSchema = z.object({
  op: z.literal("create_agent_profile"),
  name: z.string().trim().min(1).max(80),
  // Validated against the connector registry at apply (grantability included).
  capabilities: z.array(z.string().min(1).max(50)).max(50).default([]),
  customTools: z.array(resourceRefSchema).max(50).default([]),
  mcpServers: z.array(resourceRefSchema).max(50).default([]),
})

export const assignChannelProfileOpSchema = z.object({
  op: z.literal("assign_channel_profile"),
  channel: resourceRefSchema,
  // Null clears the assignment (channel falls back to the default profile).
  profile: resourceRefSchema.nullable(),
})

// Secrets NEVER ride a proposal: `requiredSecrets` only declares the names the
// template references; the approver types the values at approve time and they
// are encrypted into the tool row inside the apply transaction.
export const createCustomToolOpSchema = z.object({
  op: z.literal("create_custom_tool"),
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]{2,63}$/, "lowercase snake_case, 3-64 chars"),
  description: z.string().trim().min(1).max(500),
  argsSchema: z.record(z.string(), z.unknown()),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  urlTemplate: z.string().trim().min(1).max(2048),
  headers: z.record(z.string(), z.string()).default({}),
  bodyTemplate: z.string().max(16000).nullable().default(null),
  requiredSecrets: z.array(z.string().min(1).max(64)).max(10).default([]),
})

// Created in its normal not-yet-authorized state; a human completes OAuth (or
// fills static headers) through the existing settings flow after apply.
export const createMcpServerOpSchema = z.object({
  op: z.literal("create_mcp_server"),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  url: z.string().trim().min(1).max(2048),
  authMode: z.enum(["static", "oauth"]).default("static"),
})

// Upsert only — Merlin may propose gating an action (often one this same
// proposal creates), never removing a gate.
export const setApprovalPolicyOpSchema = z.object({
  op: z.literal("set_approval_policy"),
  target: z.discriminatedUnion("kind", [
    // An approval-target key that exists today (capability:x, custom_tool:id…).
    z.object({ kind: z.literal("key"), key: z.string().min(1).max(200) }),
    // The custom tool / MCP server another op in this proposal creates.
    z.object({
      kind: z.literal("created"),
      opPosition: z.number().int().min(0),
    }),
  ]),
  resolverKind: z.enum(["any_member", "role", "user"]).default("any_member"),
  resolverRole: z.string().min(1).max(100).optional(),
  resolverUserId: z.string().uuid().optional(),
})

export const changeOperationSchema = z.discriminatedUnion("op", [
  createChannelOpSchema,
  createWebhookOpSchema,
  setTriggerOpSchema,
  createLoopOpSchema,
  updateLoopOpSchema,
  updateInstructionsOpSchema,
  createAgentProfileOpSchema,
  assignChannelProfileOpSchema,
  createCustomToolOpSchema,
  createMcpServerOpSchema,
  setApprovalPolicyOpSchema,
])
export type ChangeOperation = z.infer<typeof changeOperationSchema>
export type ChangeOperationKind = ChangeOperation["op"]

// `satisfies` rejects a value that isn't a union kind; the reverse direction
// is enforced at every write site — spec.op (the full union) only assigns to
// the enum-typed column when the enum carries it.
export const changeOperationKindEnum = pgEnum("change_operation_kind", [
  "create_channel",
  "create_webhook",
  "set_trigger",
  "create_loop",
  "update_loop",
  "update_instructions",
  "create_agent_profile",
  "assign_channel_profile",
  "create_custom_tool",
  "create_mcp_server",
  "set_approval_policy",
] as const satisfies readonly ChangeOperationKind[])

export const CHANGE_OPERATION_KINDS: readonly ChangeOperationKind[] =
  changeOperationKindEnum.enumValues

// What Merlin sent alongside the ops.
export const proposalEvidenceSchema = z.object({
  kind: z.enum(["message", "task", "run", "url"]),
  ref: z.string().min(1).max(2048),
})
export type ProposalEvidence = z.infer<typeof proposalEvidenceSchema>

// Written per operation after apply: what it created/changed, plus anything
// the team needs to finish setup (webhook URL, "add the secret", "connect
// OAuth"). Rollback v1 is provenance, not undo — this is the provenance.
export type OperationResult = {
  resourceId?: string
  // Sensitive-but-shareable handoffs (webhook URL) shown on the applied card.
  url?: string
  // Unfinished-setup note rendered as a persistent chip until resolved.
  setupNote?: string
}

// Structurally compatible with @repo/auth's PermissionRequest without
// depending on the auth package. Loops carry no statement — channel write
// access (the resolve floor) is their only gate today, matching the live API.
const OPERATION_PERMISSIONS: Record<ChangeOperationKind, [string, string][]> = {
  create_channel: [["channel", "create"]],
  create_webhook: [["webhook", "manage"]],
  set_trigger: [["connector", "manage"]],
  create_loop: [],
  update_loop: [],
  update_instructions: [["instructions", "approve"]],
  create_agent_profile: [["agentProfile", "manage"]],
  assign_channel_profile: [["channel", "update"]],
  create_custom_tool: [["customTool", "manage"]],
  create_mcp_server: [["customTool", "manage"]],
  set_approval_policy: [["approval", "manage"]],
}

// The permission set an approver's authority must cover to approve (or
// reject) a proposal containing these ops — the union across all of them.
export function proposalPermissions(
  ops: Pick<ChangeOperation, "op">[]
): Record<string, string[]> {
  const union = new Map<string, Set<string>>()
  for (const operation of ops) {
    for (const [resource, action] of OPERATION_PERMISSIONS[operation.op]) {
      const actions = union.get(resource) ?? new Set()
      actions.add(action)
      union.set(resource, actions)
    }
  }
  return Object.fromEntries(
    [...union.entries()].map(([resource, actions]) => [resource, [...actions]])
  )
}

export const changeProposalStatusEnum = pgEnum("change_proposal_status", [
  "pending",
  "approved", // transient: approve accepted, apply transaction in flight
  "rejected",
  "applied",
  "failed", // apply rolled back; per-op error on the failing operation row
])

export const changeProposalAuthorEnum = pgEnum("change_proposal_author", [
  "user",
  "agent",
])

// A reviewable workspace change set (pillar 3, reference/change-proposals.md):
// Merlin (or a person, later) proposes typed operations; a human whose
// authority covers all of them approves; apply is one atomic transaction.
// The card message (type `proposal_card`) is the surface, like loop cards.
export const changeProposal = pgTable(
  "change_proposal",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    cardMessageId: uuid("card_message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    authorType: changeProposalAuthorEnum("author_type").notNull(),
    authorUserId: uuid("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    rationale: text("rationale").notNull(),
    evidence: jsonb("evidence").$type<ProposalEvidence[]>().notNull(),
    status: changeProposalStatusEnum("status").notNull().default("pending"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at"),
    appliedAt: timestamp("applied_at"),
    // Resolver's note on reject; apply-failure summary on failed.
    resolutionNote: text("resolution_note"),
  },
  (table) => [
    index("changeProposal_workspaceId_status_idx").on(
      table.workspaceId,
      table.status
    ),
    index("changeProposal_channelId_status_idx").on(
      table.channelId,
      table.status
    ),
    uniqueIndex("changeProposal_cardMessageId_uidx").on(table.cardMessageId),
  ]
)

export const changeProposalOperation = pgTable(
  "change_proposal_operation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => changeProposal.id, { onDelete: "cascade" }),
    // Order matters: `created` resource refs point at earlier positions.
    position: integer("position").notNull(),
    kind: changeOperationKindEnum("kind").notNull(),
    spec: jsonb("spec").$type<ChangeOperation>().notNull(),
    // Provenance, written at apply: created ids + setup handoffs.
    result: jsonb("result").$type<OperationResult>(),
    error: text("error"),
  },
  (table) => [
    uniqueIndex("changeProposalOperation_proposal_position_uidx").on(
      table.proposalId,
      table.position
    ),
  ]
)

export const changeProposalRelations = relations(
  changeProposal,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [changeProposal.workspaceId],
      references: [workspace.id],
    }),
    channel: one(channel, {
      fields: [changeProposal.channelId],
      references: [channel.id],
    }),
    operations: many(changeProposalOperation),
  })
)

export const changeProposalOperationRelations = relations(
  changeProposalOperation,
  ({ one }) => ({
    proposal: one(changeProposal, {
      fields: [changeProposalOperation.proposalId],
      references: [changeProposal.id],
    }),
  })
)

export type ChangeProposal = typeof changeProposal.$inferSelect
export type NewChangeProposal = typeof changeProposal.$inferInsert
export type ChangeProposalOperation =
  typeof changeProposalOperation.$inferSelect
export type NewChangeProposalOperation =
  typeof changeProposalOperation.$inferInsert
export type ChangeProposalStatus =
  (typeof changeProposalStatusEnum.enumValues)[number]
