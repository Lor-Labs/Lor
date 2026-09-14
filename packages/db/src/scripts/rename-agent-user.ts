import { and, eq, ne } from "drizzle-orm"
import { LOR_USER_ID } from "../constants"
import { db, schema } from "../index"

// LOR-87: renames the agent's bot user row to Lor. Every name the product
// renders comes from this row (clients read name), so the
// UI keeps saying "Merlin" until this runs. The user id never changes, so
// message/plan/reaction/artifact/proposal authorship is untouched.
// Idempotent. Independent of db:push — run order does not matter.
//
//   pnpm --filter @repo/db exec tsx src/scripts/rename-agent-user.ts \
//     [--dry-run] [--avatar=<url>]

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const avatarUrl = args
  .find((arg) => arg.startsWith("--avatar="))
  ?.slice("--avatar=".length)

const TARGET = {
  name: "Lor",
  email: "lor@lor.chat",
} as const

const current = await db
  .select({
    id: schema.user.id,
    name: schema.user.name,
    email: schema.user.email,
    image: schema.user.image,
    isBot: schema.user.isBot,
  })
  .from(schema.user)
  .where(eq(schema.user.id, LOR_USER_ID))
  .limit(1)
  .then((rows) => rows[0])

if (!current) {
  console.error(`Agent bot user ${LOR_USER_ID} not found. Run db:seed first.`)
  process.exit(1)
}

// Refuse to rewrite a human account if the id was ever reused.
if (!current.isBot) {
  console.error(
    `User ${LOR_USER_ID} is not a bot (name=${current.name}). Inspect before renaming.`
  )
  process.exit(1)
}

// email is UNIQUE — a different row holding the target value would fail the
// update, so report the culprit instead of a constraint error.
const conflict = await db
  .select({
    id: schema.user.id,
    email: schema.user.email,
  })
  .from(schema.user)
  .where(
    and(ne(schema.user.id, LOR_USER_ID), eq(schema.user.email, TARGET.email))
  )
  .limit(1)
  .then((rows) => rows[0])

if (conflict) {
  console.error(
    `User ${conflict.id} already holds email="${conflict.email}". Resolve the collision before renaming the agent.`
  )
  process.exit(1)
}

const changes: string[] = (Object.keys(TARGET) as (keyof typeof TARGET)[])
  .filter((key) => current[key] !== TARGET[key])
  .map(String)
if (avatarUrl && current.image !== avatarUrl) changes.push("image")

console.log(`Before: ${JSON.stringify(current, null, 2)}`)

if (changes.length === 0) {
  console.log("Already renamed — nothing to do.")
  process.exit(0)
}

if (dryRun) {
  console.log(`Would update: ${changes.join(", ")}`)
  process.exit(0)
}

const updated = await db
  .update(schema.user)
  .set({
    ...TARGET,
    ...(avatarUrl ? { image: avatarUrl } : {}),
    updatedAt: new Date(),
  })
  .where(eq(schema.user.id, LOR_USER_ID))
  .returning({
    id: schema.user.id,
    name: schema.user.name,
    email: schema.user.email,
    image: schema.user.image,
  })
  .then((rows) => rows[0])

console.log(`After: ${JSON.stringify(updated, null, 2)}`)
console.log(
  `Renamed the agent user (${changes.join(", ")}). Connected clients cache author names per message — reload to see it.`
)
process.exit(0)
