import { randomUUID } from "node:crypto"
import { closeDb, db, eq, schema } from "@repo/db"
import { getBillingSummary } from "../autumn"
import { getAutumn } from "../client"
import { CREDITS_FEATURE_ID } from "../constants"

// Dev/admin utility: grant credits to a workspace out-of-band (no Stripe).
// Usage: pnpm credits:grant <workspace slug or id> [amount]
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_AMOUNT = 2000

const [target, amountArg] = process.argv.slice(2)
if (!target) {
  console.error("Usage: pnpm credits:grant <workspace slug or id> [amount]")
  process.exit(1)
}
const amount = amountArg ? Number(amountArg) : DEFAULT_AMOUNT
if (!Number.isInteger(amount) || amount <= 0) {
  console.error(`Amount must be a positive integer, got "${amountArg}"`)
  process.exit(1)
}

const autumn = getAutumn()
if (!autumn) {
  console.error(
    "AUTUMN_SECRET_KEY is unset — billing is disabled and every credit check already passes; nothing to grant."
  )
  process.exit(1)
}

const workspace = await db
  .select({
    id: schema.workspace.id,
    name: schema.workspace.name,
    slug: schema.workspace.slug,
  })
  .from(schema.workspace)
  .where(
    UUID_RE.test(target)
      ? eq(schema.workspace.id, target)
      : eq(schema.workspace.slug, target)
  )
  .limit(1)
  .then((rows) => rows[0])

if (!workspace) {
  console.error(`No workspace found for "${target}"`)
  await closeDb()
  process.exit(1)
}

await autumn.customers.getOrCreate({
  customerId: workspace.id,
  name: workspace.name,
})
await autumn.balances.create({
  customerId: workspace.id,
  featureId: CREDITS_FEATURE_ID,
  includedGrant: amount,
  balanceId: `manual_${randomUUID().slice(0, 8)}`,
})

const summary = await getBillingSummary(workspace.id)
console.log(
  `✓ Granted ${amount} credits to ${workspace.name} (${workspace.slug}). Balance: ${summary?.balance?.total ?? "unknown"}`
)
await closeDb()
