import { and, db, eq, MERLIN_USER_ID, schema } from "@repo/db"
import { writePage } from "../brain"
import { ingestSource } from "../sources"

// Seeds a fresh, known workspace for the eval harness: brain pages, a connected
// GitHub source, and a little chat history — enough to assert retrieval,
// citation, honesty, and write-back. Reuses the real write paths (writePage /
// ingestSource) so embeddings are produced exactly as in production.

export type SeededWorkspace = {
  workspaceId: string
  channelId: string
  userId: string
  userName: string
  cleanup: () => Promise<void>
}

function required<T>(rows: T[], what: string): T {
  const row = rows[0]
  if (!row) throw new Error(`seed: failed to insert ${what}`)
  return row
}

// The global Merlin bot user (idempotent) — workspace membership + message
// authorship reference this fixed id.
async function ensureMerlinUser(): Promise<void> {
  await db
    .insert(schema.user)
    .values({
      id: MERLIN_USER_ID,
      name: "Merlin",
      email: "merlin@lor.chat",
      username: "merlin",
      displayUsername: "Merlin",
      emailVerified: true,
      onboardingCompleted: true,
      isBot: true,
    })
    .onConflictDoNothing({ target: schema.user.id })
}

export async function seedEvalWorkspace(): Promise<SeededWorkspace> {
  await ensureMerlinUser()
  const stamp = Date.now()
  const userName = "Bucky"

  const user = required(
    await db
      .insert(schema.user)
      .values({
        name: userName,
        email: `eval+${stamp}@lor.chat`,
        username: `eval_${stamp}`,
        emailVerified: true,
      })
      .returning({ id: schema.user.id }),
    "user"
  )

  const workspace = required(
    await db
      .insert(schema.workspace)
      .values({
        name: "Eval Workspace",
        slug: `eval-${stamp}`,
        ownerId: user.id,
        createdAt: new Date(),
      })
      .returning({ id: schema.workspace.id }),
    "workspace"
  )

  await db.insert(schema.workspaceMember).values([
    { workspaceId: workspace.id, userId: user.id, role: "admin" },
    { workspaceId: workspace.id, userId: MERLIN_USER_ID, role: "member" },
  ])

  const channel = required(
    await db
      .insert(schema.channel)
      .values({
        name: "general",
        type: "text",
        workspaceId: workspace.id,
        position: 0,
      })
      .returning({ id: schema.channel.id }),
    "channel"
  )

  // Brain pages (writePage embeds + creates parent folders).
  await writePage(
    workspace.id,
    "/people/alice",
    "Alice is the engineering lead. She owns API architecture and runs hiring for the team."
  )
  await writePage(
    workspace.id,
    "/decisions/auth",
    "We chose JWT with refresh tokens for API authentication (decided 2026-05). Rationale: stateless and horizontally scalable; server-side sessions were dropped to avoid sticky load balancing."
  )

  // A connected GitHub source (ingestSource summarizes + embeds).
  const connection = required(
    await db
      .insert(schema.integrationConnection)
      .values({
        workspaceId: workspace.id,
        provider: "github",
        externalId: `eval-install-${stamp}`,
        accountLogin: "eval-org",
        status: "active",
      })
      .returning({ id: schema.integrationConnection.id }),
    "integration connection"
  )
  await ingestSource({
    workspaceId: workspace.id,
    connectionId: connection.id,
    provider: "github",
    kind: "pull_request",
    externalId: "eval-org/app#42",
    url: "https://github.com/eval-org/app/pull/42",
    title: "Add JWT refresh-token rotation",
    author: "alice",
    occurredAt: new Date(),
    content:
      "Implements refresh-token rotation for the auth service: short-lived access tokens, rotating refresh tokens stored hashed, and automatic revocation when a used token is replayed.",
  })

  // Chat history for FTS (search_messages).
  await db.insert(schema.message).values([
    {
      channelId: channel.id,
      authorId: user.id,
      content:
        "We're migrating the billing service onto the new internal API next sprint — heads up to anyone with integrations.",
      type: "default",
    },
    {
      channelId: channel.id,
      authorId: user.id,
      content: "Reminder: standup moved to 10am on Mondays.",
      type: "default",
    },
  ])

  const cleanup = async (): Promise<void> => {
    // Source before connection (FK), then the rest; workspace delete cascades
    // channels/messages/members. Belt-and-suspenders explicit deletes so nothing
    // leaks if a cascade isn't configured.
    await db
      .delete(schema.source)
      .where(eq(schema.source.workspaceId, workspace.id))
    await db
      .delete(schema.integrationConnection)
      .where(eq(schema.integrationConnection.workspaceId, workspace.id))
    await db
      .delete(schema.brainNode)
      .where(eq(schema.brainNode.workspaceId, workspace.id))
    await db
      .delete(schema.workspace)
      .where(eq(schema.workspace.id, workspace.id))
    await db.delete(schema.user).where(eq(schema.user.id, user.id))
  }

  return {
    workspaceId: workspace.id,
    channelId: channel.id,
    userId: user.id,
    userName,
    cleanup,
  }
}

// Brain pages currently in the workspace — used to detect write-back creations.
export async function listBrainPages(
  workspaceId: string
): Promise<{ id: string; name: string; body: string | null }[]> {
  return db
    .select({
      id: schema.brainNode.id,
      name: schema.brainNode.name,
      body: schema.brainNode.body,
    })
    .from(schema.brainNode)
    .where(
      and(
        eq(schema.brainNode.workspaceId, workspaceId),
        eq(schema.brainNode.kind, "page")
      )
    )
}
