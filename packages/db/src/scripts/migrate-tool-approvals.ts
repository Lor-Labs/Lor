// One-off for per-tool approvals (reference/approval-policies.md, "Breaking
// rollout"). Profiles and approval rules used to name whole capability groups
// ("linear_write") or whole MCP servers. They now name single tools, and the
// lor_capability enum keeps only web, artifacts and custom_tools. This script:
//   1. Removes connector values from agent_profile.capabilities and shrinks the
//      lor_capability enum. db:push can't do this while rows hold old values.
//   2. Deletes capability:* and mcp_server:* approval rules. There is no
//      automatic conversion; admins choose individual tools again.
//   3. Expires pending approvals for those old keys and moves their plans from
//      waiting_for_approval to waiting_for_input, so no plan waits forever.
// Safe to rerun. Once per environment, with the API and workers stopped, before
// `pnpm db:push` and before the new code starts:
//   pnpm --filter @repo/db exec tsx src/scripts/migrate-tool-approvals.ts --dry-run
//   pnpm --filter @repo/db exec tsx src/scripts/migrate-tool-approvals.ts
import { type AnyColumn, and, eq, inArray, notExists, sql } from "drizzle-orm"
import { db, schema } from "../index"

const dryRun = process.argv.includes("--dry-run")
const { approval, approvalPolicy, plan } = schema

const STANDALONE = sql.raw(`ARRAY['web', 'artifacts', 'custom_tools']`)
const legacyTarget = (column: AnyColumn) =>
  sql`${column} ~ '^(capability|mcp_server):'`

const enumLabels = (
  await db.execute<{ label: string }>(sql`
    SELECT e.enumlabel AS label
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'lor_capability'
    ORDER BY e.enumsortorder`)
).map((row) => row.label)
const enumNeedsShrink = enumLabels.join(",") !== "web,artifacts,custom_tools"

const profiles = await db
  .execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM agent_profile
    WHERE NOT (capabilities::text[] <@ ${STANDALONE})`)
  .then((rows) => rows[0]?.count ?? 0)
const policies = await db
  .execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM approval_policy
    WHERE ${legacyTarget(approvalPolicy.target)}`)
  .then((rows) => rows[0]?.count ?? 0)
const pendingLegacy = and(
  eq(approval.status, "pending"),
  legacyTarget(approval.target)
)
const pending = await db
  .select({ id: approval.id, planId: approval.planId })
  .from(approval)
  .where(pendingLegacy)
const pendingPlanIds = [
  ...new Set(
    pending.map((row) => row.planId).filter((id): id is string => id !== null)
  ),
]
const waitingPlans =
  pendingPlanIds.length === 0
    ? 0
    : (
        await db
          .select({ id: plan.id })
          .from(plan)
          .where(
            and(
              inArray(plan.id, pendingPlanIds),
              eq(plan.status, "waiting_for_approval")
            )
          )
      ).length

console.log(`lor_capability enum: ${enumLabels.join(", ")}`)
console.log(`Profiles with connector capabilities: ${profiles}`)
console.log(`Capability or whole-server approval rules: ${policies}`)
console.log(`Pending approvals with old keys: ${pending.length}`)
console.log(`Plans waiting on those approvals: ${waitingPlans}`)

if (dryRun) {
  console.log(
    `\nDry run: ${enumNeedsShrink ? "would shrink the enum" : "enum already migrated"}, no changes made.`
  )
  process.exit(0)
}

const result = await db.transaction(async (tx) => {
  if (enumNeedsShrink) {
    await tx.execute(sql`LOCK TABLE agent_profile IN ACCESS EXCLUSIVE MODE`)
    await tx.execute(sql`
      UPDATE agent_profile
      SET capabilities = ARRAY(
        SELECT value FROM unnest(capabilities) AS grants(value)
        WHERE value::text = ANY(${STANDALONE})
      )
      WHERE NOT (capabilities::text[] <@ ${STANDALONE})`)
    await tx.execute(
      sql`ALTER TABLE agent_profile ALTER COLUMN capabilities DROP DEFAULT`
    )
    await tx.execute(
      sql`CREATE TYPE lor_capability_next AS ENUM ('web', 'artifacts', 'custom_tools')`
    )
    await tx.execute(sql`
      ALTER TABLE agent_profile ALTER COLUMN capabilities
      TYPE lor_capability_next[]
      USING capabilities::text[]::lor_capability_next[]`)
    await tx.execute(sql`DROP TYPE lor_capability`)
    await tx.execute(
      sql`ALTER TYPE lor_capability_next RENAME TO lor_capability`
    )
    await tx.execute(
      sql`ALTER TABLE agent_profile ALTER COLUMN capabilities SET DEFAULT '{}'`
    )
  }

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
  `\nDone: ${enumNeedsShrink ? `enum shrunk and ${profiles} profiles cleaned, ` : ""}${result.deleted} rules deleted, ${result.expired} approvals expired, ${result.unblocked} plans moved to waiting_for_input.`
)
process.exit(0)
