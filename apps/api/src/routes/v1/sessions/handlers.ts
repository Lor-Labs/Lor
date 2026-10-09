import { asc, db, eq, inArray, schema } from "@repo/db"
import { toRealtimeAgentSession } from "@repo/lor/agent-sessions"
import { USER_MENTION_REGEX } from "@repo/messaging"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type { GetAgentSessionRoute } from "@/routes/v1/sessions/routes"

export const getAgentSession: AppRouteHandler<GetAgentSessionRoute> = async (
  c
) => {
  const currentUser = c.var.user
  const { sessionId } = c.req.valid("param")

  const row = await db
    .select({
      session: schema.agentSession,
      channelName: schema.channel.name,
      channelWorkspaceId: schema.channel.workspaceId,
    })
    .from(schema.agentSession)
    .innerJoin(
      schema.channel,
      eq(schema.agentSession.channelId, schema.channel.id)
    )
    .where(eq(schema.agentSession.id, sessionId))
    .limit(1)
    .then((rows) => rows[0])

  // Same 404 for "doesn't exist" and "not allowed", so session ids can't
  // probe private channels.
  if (
    !row ||
    row.channelWorkspaceId !== row.session.workspaceId ||
    !(await userCanAccessChannel(row.session.channelId, currentUser.id))
  ) {
    return c.json(
      { success: false as const, message: "Session not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const context = await db
    .select({
      id: schema.message.id,
      authorName: schema.user.name,
      authorImage: schema.user.image,
      content: schema.message.content,
      createdAt: schema.message.createdAt,
    })
    .from(schema.agentSessionContext)
    .innerJoin(
      schema.message,
      eq(schema.agentSessionContext.messageId, schema.message.id)
    )
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(eq(schema.agentSessionContext.sessionId, sessionId))
    .orderBy(asc(schema.message.createdAt))

  const mentionedIds = [
    ...new Set(
      context.flatMap((message) =>
        [...(message.content ?? "").matchAll(USER_MENTION_REGEX)].map(
          (match) => match[1] ?? ""
        )
      )
    ),
  ].filter(Boolean)
  const mentionedNames = new Map(
    (mentionedIds.length === 0
      ? []
      : await db
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(inArray(schema.user.id, mentionedIds))
    ).map((user) => [user.id, user.name])
  )

  return c.json(
    {
      session: toRealtimeAgentSession(row.session),
      channel: { id: row.session.channelId, name: row.channelName },
      context: context.map((message) => ({
        id: message.id,
        authorName: message.authorName,
        authorImage: message.authorImage,
        text: (message.content ?? "").replace(
          USER_MENTION_REGEX,
          (_token, id: string) => `@${mentionedNames.get(id) ?? "someone"}`
        ),
        createdAt: message.createdAt.toISOString(),
      })),
    },
    HttpStatusCodes.OK
  )
}
