// One-off for the onboarding redesign: gives every workspace a new opaque URL
// key (workspace.slug) and marks it as set up, so existing workspaces skip
// the first-run checklist. Bookmarks break, and OAuth MCP servers must be
// reconnected because their registered redirect URI embeds the old key.
// Run after db:push, once per environment:
//   pnpm --filter @repo/db exec tsx src/scripts/rekey-workspaces.ts --dry-run
//   pnpm --filter @repo/db exec tsx src/scripts/rekey-workspaces.ts
import { workspaceKey } from "@repo/utils/short-code"
import { eq } from "drizzle-orm"
import { db, schema } from "../index"

const dryRun = process.argv.includes("--dry-run")

const workspaces = await db
  .select({
    id: schema.workspace.id,
    name: schema.workspace.name,
    slug: schema.workspace.slug,
    setupCompletedAt: schema.workspace.setupCompletedAt,
  })
  .from(schema.workspace)

const rekeys = workspaces.map((workspace) => ({
  ...workspace,
  newSlug: workspaceKey(),
}))

for (const { slug, newSlug, name } of rekeys) {
  console.log(`${slug} -> ${newSlug}  (${name})`)
}

if (!dryRun) {
  const now = new Date()
  await db.transaction(async (tx) => {
    for (const { id, newSlug, setupCompletedAt } of rekeys) {
      await tx
        .update(schema.workspace)
        .set({ slug: newSlug, setupCompletedAt: setupCompletedAt ?? now })
        .where(eq(schema.workspace.id, id))
    }
  })
}

const oauthMcpServers = await db
  .select({
    workspaceName: schema.workspace.name,
    serverName: schema.mcpServer.name,
  })
  .from(schema.mcpServer)
  .innerJoin(
    schema.workspace,
    eq(schema.workspace.id, schema.mcpServer.workspaceId)
  )
  .where(eq(schema.mcpServer.authMode, "oauth"))

if (oauthMcpServers.length > 0) {
  console.log("\nReconnect these OAuth MCP servers:")
  for (const { workspaceName, serverName } of oauthMcpServers) {
    console.log(`  ${workspaceName}: ${serverName}`)
  }
}

console.log(
  dryRun
    ? `\nDry run: ${rekeys.length} workspaces would be rekeyed.`
    : `\nRekeyed ${rekeys.length} workspaces.`
)
process.exit(0)
