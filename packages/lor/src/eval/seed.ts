import { and, db, eq, LOR_USER_ID, schema } from "@repo/db"
import { pickWorkspaceAvatarColor } from "@repo/utils/avatar-colors"
import { writePage } from "../brain"
import { embedDocument } from "../embeddings"
import { ingestSource } from "../sources"

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

async function ensureLorUser(): Promise<void> {
  await db
    .insert(schema.user)
    .values({
      id: LOR_USER_ID,
      name: "Lor",
      email: "lor@lor.chat",
      username: "lor",
      displayUsername: "Lor",
      emailVerified: true,
      onboardingCompleted: true,
      isBot: true,
    })
    .onConflictDoNothing({ target: schema.user.id })
}

export async function seedEvalWorkspace(): Promise<SeededWorkspace> {
  await ensureLorUser()
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

  const userAvatarColor = pickWorkspaceAvatarColor(
    [],
    `${workspace.id}:${user.id}`
  )
  const lorAvatarColor = pickWorkspaceAvatarColor(
    [userAvatarColor],
    `${workspace.id}:${LOR_USER_ID}`
  )

  await db.insert(schema.workspaceMember).values([
    {
      workspaceId: workspace.id,
      userId: user.id,
      role: "admin",
      avatarColor: userAvatarColor,
    },
    {
      workspaceId: workspace.id,
      userId: LOR_USER_ID,
      role: "member",
      avatarColor: lorAvatarColor,
    },
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
  await writePage(
    workspace.id,
    "/handbook/office",
    "The office handbook covers visitor access, meeting-room booking, and equipment requests."
  )
  await writePage(
    workspace.id,
    "/projects/website",
    "The website project focuses on marketing copy, accessibility, and page-load performance."
  )

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

  const sourceDistractors = [
    {
      externalId: "eval-org/app#43",
      title: "Update dashboard color palette",
      summary:
        "Updates dashboard colors and contrast tokens to match the revised visual design system.",
    },
    {
      externalId: "eval-org/app#44",
      title: "Optimize image upload pipeline",
      summary:
        "Reduces media upload latency by resizing images earlier and parallelizing object storage writes.",
    },
    {
      externalId: "eval-org/app#45",
      title: "Export monthly billing reports",
      summary:
        "Adds scheduled CSV exports for monthly invoices and payment reconciliation.",
    },
  ]
  for (const distractor of sourceDistractors) {
    await db.insert(schema.source).values({
      workspaceId: workspace.id,
      connectionId: connection.id,
      provider: "github",
      kind: "pull_request",
      externalId: distractor.externalId,
      url: `https://github.com/eval-org/app/pull/${distractor.externalId.split("#")[1]}`,
      title: distractor.title,
      author: "eval-contributor",
      summary: distractor.summary,
      embedding: await embedDocument(distractor.summary).catch(() => null),
      occurredAt: new Date(),
    })
  }

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
