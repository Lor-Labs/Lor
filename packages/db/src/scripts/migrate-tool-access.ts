// One-off for per-tool access and approvals (reference/approval-policies.md,
// "Breaking rollout"). Profiles used to grant web, artifacts and API tools
// through the lor_capability enum, grants_all and agent_profile_custom_tool;
// approval rules named whole capability groups or MCP servers. Everything now
// lives in agent_profile.tool_access and names single tools. This script:
//   1. Moves each profile's old grants into tool_access. What it had stays on;
//      what it lacked becomes "off" (or a custom API tool list).
//   2. Rewrites pending create_agent_profile proposals the same way.
//   3. Drops capabilities, grants_all, agent_profile_custom_tool and the enum,
//      so db:push has nothing left to change.
//   4. Deletes capability:* and mcp_server:* approval rules (no conversion;
//      admins choose individual tools again), expires pending approvals for
//      those keys, and moves their plans to waiting_for_input.
// One transaction, safe to rerun. Once per environment, with the API and
// workers stopped, before `pnpm db:push` and before the new code starts:
//   pnpm --filter @repo/db exec tsx src/scripts/migrate-tool-access.ts --dry-run
//   pnpm --filter @repo/db exec tsx src/scripts/migrate-tool-access.ts
import { type AnyColumn, and, eq, inArray, notExists, sql } from "drizzle-orm"
import { db, schema } from "../index"
import type { ChangeOperation, ProfileToolAccess } from "../schemas/index"

const dryRun = process.argv.includes("--dry-run")
const {
  agentProfile,
  approval,
  approvalPolicy,
  changeProposal,
  changeProposalOperation,
  plan,
} = schema

type Legacy = {
  grantsAll: boolean
  capabilities: string[]
  customToolIds: string[]
}

// Missing entries follow the workspace (on), so only lost grants need writing.
function convertAccess(
  stored: Partial<ProfileToolAccess>,
  legacy: Legacy | null
): ProfileToolAccess {
  const access: ProfileToolAccess = {
    connectors: stored.connectors ?? {},
    mcpServers: stored.mcpServers ?? {},
    builtins: { ...stored.builtins },
    ...(stored.customTools ? { customTools: stored.customTools } : {}),
  }
  if (!legacy || legacy.grantsAll) return access
  const caps = new Set(legacy.capabilities)
  for (const group of ["web", "artifacts"] as const) {
    if (!caps.has(group)) access.builtins[group] ??= { mode: "off" }
  }
  if (!caps.has("custom_tools"))
    access.customTools ??=
      legacy.customToolIds.length > 0
        ? { mode: "custom", tools: legacy.customToolIds }
        : { mode: "off" }
  return access
}

// Old ops always stored `capabilities` (schema default). customTools refs keep
// limiting API tools; the custom_tools capability meant all of them.
function convertOp(spec: Record<string, unknown>): ChangeOperation | null {
  if (!("capabilities" in spec)) return null
  const { capabilities, ...rest } = spec
  const caps = Array.isArray(capabilities) ? capabilities.map(String) : []
  const refs =
    caps.includes("custom_tools") || !Array.isArray(rest.customTools)
      ? []
      : rest.customTools
  const toolAccess = convertAccess(
    (rest.toolAccess ?? {}) as Partial<ProfileToolAccess>,
    { grantsAll: false, capabilities: caps, customToolIds: [] }
  )
  if (refs.length > 0) delete toolAccess.customTools
  return { ...rest, toolAccess, customTools: refs } as ChangeOperation
}

const stable = (value: unknown) =>
  JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([a], [b]) => a.localeCompare(b))
        )
      : inner
  )

const legacyColumns = await db
  .execute<{ name: string }>(sql`
    SELECT column_name AS name FROM information_schema.columns
    WHERE table_name = 'agent_profile'
      AND column_name IN ('capabilities', 'grants_all')`)
  .then((rows) => rows.map((row) => row.name))
const hasLegacyProfiles = legacyColumns.length === 2
const hasGrantTable = await db
  .execute<{ present: boolean }>(
    sql`SELECT to_regclass('agent_profile_custom_tool') IS NOT NULL AS present`
  )
  .then((rows) => rows[0]?.present ?? false)

const profileRows = await db.execute<{
  id: string
  tool_access: Partial<ProfileToolAccess> | null
  grants_all: boolean | null
  capabilities: string[] | null
  tool_ids: string[] | null
}>(
  hasLegacyProfiles
    ? sql`
        SELECT p.id, p.tool_access, p.grants_all,
          p.capabilities::text[] AS capabilities,
          ${
            hasGrantTable
              ? sql`(SELECT coalesce(array_agg(g.custom_tool_id::text), '{}')
                  FROM agent_profile_custom_tool g WHERE g.profile_id = p.id)`
              : sql`'{}'::text[]`
          } AS tool_ids
        FROM agent_profile p`
    : sql`
        SELECT id, tool_access, NULL AS grants_all, NULL AS capabilities,
          NULL AS tool_ids
        FROM agent_profile`
)
const profileUpdates = profileRows.flatMap((row) => {
  const next = convertAccess(
    row.tool_access ?? {},
    hasLegacyProfiles
      ? {
          grantsAll: Boolean(row.grants_all),
          capabilities: row.capabilities ?? [],
          customToolIds: row.tool_ids ?? [],
        }
      : null
  )
  return stable(next) === stable(row.tool_access)
    ? []
    : [{ id: row.id, toolAccess: next }]
})

const opUpdates = (
  await db
    .select({
      id: changeProposalOperation.id,
      spec: changeProposalOperation.spec,
    })
    .from(changeProposalOperation)
    .innerJoin(
      changeProposal,
      eq(changeProposal.id, changeProposalOperation.proposalId)
    )
    .where(
      and(
        eq(changeProposal.status, "pending"),
        eq(changeProposalOperation.kind, "create_agent_profile")
      )
    )
).flatMap((row) => {
  const spec = convertOp(row.spec as Record<string, unknown>)
  return spec ? [{ id: row.id, spec }] : []
})

const legacyTarget = (column: AnyColumn) =>
  sql`${column} ~ '^(capability|mcp_server):'`
const policies = await db
  .select({ id: approvalPolicy.id })
  .from(approvalPolicy)
  .where(legacyTarget(approvalPolicy.target))
const pendingLegacy = and(
  eq(approval.status, "pending"),
  legacyTarget(approval.target)
)
const pending = await db
  .select({ planId: approval.planId })
  .from(approval)
  .where(pendingLegacy)

console.log(
  `Old profile columns: ${hasLegacyProfiles ? "present" : "already removed"}`
)
console.log(`Profiles to update: ${profileUpdates.length}`)
console.log(`Pending profile proposals to rewrite: ${opUpdates.length}`)
console.log(`Capability or whole-server approval rules: ${policies.length}`)
console.log(`Pending approvals with old keys: ${pending.length}`)

if (dryRun) {
  console.log("\nDry run: no changes made.")
  process.exit(0)
}

const result = await db.transaction(async (tx) => {
  await tx.execute(sql`LOCK TABLE agent_profile IN ACCESS EXCLUSIVE MODE`)
  for (const update of profileUpdates) {
    await tx
      .update(agentProfile)
      .set({ toolAccess: update.toolAccess })
      .where(eq(agentProfile.id, update.id))
  }
  for (const update of opUpdates) {
    await tx
      .update(changeProposalOperation)
      .set({ spec: update.spec })
      .where(eq(changeProposalOperation.id, update.id))
  }
  await tx.execute(sql`
    ALTER TABLE agent_profile
      DROP COLUMN IF EXISTS capabilities,
      DROP COLUMN IF EXISTS grants_all`)
  await tx.execute(sql`DROP TABLE IF EXISTS agent_profile_custom_tool`)
  await tx.execute(sql`DROP TYPE IF EXISTS lor_capability`)

  const deleted = await tx
    .delete(approvalPolicy)
    .where(legacyTarget(approvalPolicy.target))
    .returning({ id: approvalPolicy.id })
  const expired = await tx
    .update(approval)
    .set({ status: "expired", resolvedAt: new Date() })
    .where(pendingLegacy)
    .returning({ planId: approval.planId })
  const planIds = [
    ...new Set(
      expired.map((row) => row.planId).filter((id): id is string => id !== null)
    ),
  ]
  // Same parked state an abandoned approval continuation leaves.
  const plans =
    planIds.length === 0
      ? []
      : await tx
          .update(plan)
          .set({ status: "waiting_for_input" })
          .where(
            and(
              inArray(plan.id, planIds),
              eq(plan.status, "waiting_for_approval"),
              notExists(
                tx
                  .select({ id: approval.id })
                  .from(approval)
                  .where(
                    and(
                      eq(approval.planId, plan.id),
                      eq(approval.status, "pending")
                    )
                  )
              )
            )
          )
          .returning({ id: plan.id })
  return {
    deleted: deleted.length,
    expired: expired.length,
    unblocked: plans.length,
  }
})

console.log(
  `\nDone: ${profileUpdates.length} profiles and ${opUpdates.length} proposals updated, old profile columns dropped, ${result.deleted} rules deleted, ${result.expired} approvals expired, ${result.unblocked} plans moved to waiting_for_input.`
)
process.exit(0)
