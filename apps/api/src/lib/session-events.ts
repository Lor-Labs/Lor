import { db, schema } from "@repo/db"
import type {
  AgentSession,
  SessionCommittedPayload,
  SessionForkedPayload,
  SessionPullRequestPayload,
  SessionPushedPayload,
  SessionReviewedPayload,
  SessionRewoundPayload,
  SessionSetupChangedPayload,
} from "@repo/db/schema"
import type { RealtimeMessage } from "@repo/realtime-types"
import { threadRoom } from "@repo/realtime-types/rooms"
import { getEmitter } from "@/lib/bot-messages"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

export type EventAuthor = { id: string; name: string; image: string | null }

export const eventAuthor = (user: {
  id: string
  name: string
  image?: string | null
}): EventAuthor => ({ id: user.id, name: user.name, image: user.image ?? null })

// A commit, push, fork, review or setup change as a line in the session, for
// its people and for Lor there.
export async function postSessionEvent(
  session: Pick<AgentSession, "channelId" | "threadRootId" | "workspaceId">,
  author: EventAuthor,
  event:
    | { eventType: "session_committed"; eventPayload: SessionCommittedPayload }
    | { eventType: "session_pushed"; eventPayload: SessionPushedPayload }
    | { eventType: "session_forked"; eventPayload: SessionForkedPayload }
    | { eventType: "session_rewound"; eventPayload: SessionRewoundPayload }
    | { eventType: "session_reviewed"; eventPayload: SessionReviewedPayload }
    | {
        eventType: "session_pr_opened" | "session_pr_merged"
        eventPayload: SessionPullRequestPayload
      }
    | {
        eventType: "session_setup_changed"
        eventPayload: SessionSetupChangedPayload
      },
  content: string
) {
  const [row] = await db
    .insert(schema.message)
    .values({
      channelId: session.channelId,
      authorId: author.id,
      type: "event",
      ...event,
      content,
      threadRootId: session.threadRootId,
      excludedFromMemory: true,
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
  if (!row) return
  const message: RealtimeMessage = {
    id: row.id,
    channelId: session.channelId,
    content,
    type: "event",
    ...event,
    pinned: false,
    createdAt: row.createdAt.toISOString(),
    author,
    overrideName: null,
    overrideAvatarUrl: null,
    mentions: [],
    reactions: [],
    attachments: [],
    embeds: [],
    referencedMessage: null,
    threadRootId: session.threadRootId,
  }
  const io = await getEmitter()
  io.to(threadRoom(session.threadRootId)).emit("message:created", message)
  notifyWorkspaceActivity(session.workspaceId)
}
