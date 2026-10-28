import { and, db, eq, or, schema, sql } from "@repo/db"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import type { SessionUncommittedUpdated } from "@repo/realtime-types"
import { type ChangedFile, type CodeSandbox, readChanges } from "./code-changes"
import { logger } from "./logger"

// The sidebar's +/− on a code session row: its uncommitted lines (staged,
// unstaged and untracked, against HEAD), the Changes panel's total. Saved
// only where a sandbox is already open (a turn, the panel, commit, pull,
// rewind), so the sidebar never wakes one.

export type UncommittedLinesUpdate = {
  payload: SessionUncommittedUpdated
  // Subscribers who can still see the channel: the people with the row.
  userIds: string[]
}

// Null when the count didn't change.
export async function recordUncommittedLines(
  sessionId: string,
  files: Pick<ChangedFile, "additions" | "deletions">[]
): Promise<UncommittedLinesUpdate | null> {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    additions += file.additions ?? 0
    deletions += file.deletions ?? 0
  }
  const [row] = await db
    .update(schema.agentSession)
    .set({ uncommittedAdditions: additions, uncommittedDeletions: deletions })
    .where(
      and(
        eq(schema.agentSession.id, sessionId),
        or(
          sql`${schema.agentSession.uncommittedAdditions} is distinct from ${additions}`,
          sql`${schema.agentSession.uncommittedDeletions} is distinct from ${deletions}`
        )
      )
    )
    .returning({
      workspaceId: schema.agentSession.workspaceId,
      channelId: schema.agentSession.channelId,
      threadRootId: schema.agentSession.threadRootId,
    })
  if (!row) return null
  const [subscribers, audience] = await Promise.all([
    db
      .select({ userId: schema.threadSubscription.userId })
      .from(schema.threadSubscription)
      .where(eq(schema.threadSubscription.threadRootId, row.threadRootId)),
    listChannelAudienceUserIds(row.channelId),
  ])
  const canSee = new Set(audience)
  return {
    payload: {
      workspaceId: row.workspaceId,
      channelId: row.channelId,
      sessionId,
      additions,
      deletions,
    },
    userIds: subscribers
      .map((subscriber) => subscriber.userId)
      .filter((userId) => canSee.has(userId)),
  }
}

// One read after each burst of tool calls, at a fixed deadline so a long run
// of edits can't postpone it.
const TURN_READ_DELAY_MS = 1_500

export type UncommittedLinesTracker = ReturnType<typeof trackUncommittedLines>

// A turn's edits move the count live. Reads take no index lock, so they run
// beside the agent's own git; one read at a time.
export function trackUncommittedLines(input: {
  sandbox: CodeSandbox
  sessionId: string
  baseBranch: string
  onUpdate?: (update: UncommittedLinesUpdate) => void
}) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let reading: Promise<void> = Promise.resolve()
  const read = () => {
    if (timer) clearTimeout(timer)
    timer = null
    reading = reading.then(async () => {
      try {
        const changes = await readChanges(input.sandbox, input.baseBranch)
        const update = await recordUncommittedLines(
          input.sessionId,
          changes.files
        )
        if (update) input.onUpdate?.(update)
      } catch (err) {
        logger.warn(
          { err, sessionId: input.sessionId },
          "Uncommitted lines read failed"
        )
      }
    })
    return reading
  }
  return {
    // A tool call that may have changed files finished.
    changed() {
      timer ??= setTimeout(() => void read(), TURN_READ_DELAY_MS)
    },
    // The turn's final count.
    flush: read,
    // Before the sandbox closes: a stopped or failed turn still counts its
    // last edits.
    stop() {
      return timer ? read() : reading
    },
  }
}
