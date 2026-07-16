import type { RealtimeMessageThreadUpdated } from "@repo/realtime-types"
import { describe, expect, it } from "vitest"
import type { Message } from "./api-types"
import {
  appendMerlinReasoning,
  buildMerlinSegments,
  upsertMerlinToolCall,
} from "./merlin"
import {
  applyReactionUpdate,
  applyThreadSummaryUpdate,
  createOptimisticMessage,
  mergeMessages,
  realtimeMessageToMessage,
  removeMessage,
  rollbackOptimisticReply,
} from "./messages"

const author = {
  id: "user-1",
  name: "Avery Stone",
  username: "avery",
  displayUsername: "Avery",
  image: null,
}

function makeMessage(id: string, createdAt: string, content = id): Message {
  return {
    ...createOptimisticMessage({
      nonce: id,
      channelId: "channel-1",
      content,
      author,
    }),
    id,
    createdAt,
  }
}

function makeThreadUpdate(
  overrides: Partial<RealtimeMessageThreadUpdated> = {}
): RealtimeMessageThreadUpdated {
  return {
    channelId: "channel-1",
    threadRootId: "root-1",
    replyCount: 2,
    lastReplyAt: "2026-07-14T12:03:00.000Z",
    participants: [
      {
        id: author.id,
        name: author.name,
        displayUsername: author.displayUsername,
        image: author.image,
      },
    ],
    lastReply: null,
    ...overrides,
  }
}

describe("message collection helpers", () => {
  it("deduplicates messages, keeps the preferred copy, and sorts newest first", () => {
    const older = makeMessage("older", "2026-07-14T12:00:00.000Z")
    const preferred = makeMessage(
      "newer",
      "2026-07-14T12:02:00.000Z",
      "updated"
    )
    const stale = { ...preferred, content: "stale" }

    const result = mergeMessages([preferred], [older, stale])

    expect(result.map((message) => message.id)).toEqual(["newer", "older"])
    expect(result[0]?.content).toBe("updated")
  })

  it("merges an older pagination page without duplicates or order changes", () => {
    const latest = makeMessage("latest", "2026-07-14T12:03:00.000Z")
    const boundary = makeMessage("boundary", "2026-07-14T12:02:00.000Z")
    const oldest = makeMessage("oldest", "2026-07-14T12:01:00.000Z")

    const result = mergeMessages([latest, boundary], [boundary, oldest])

    expect(result.map((message) => message.id)).toEqual([
      "latest",
      "boundary",
      "oldest",
    ])
  })

  it("creates optimistic replies under the supplied thread root", () => {
    const referenced = makeMessage(
      "referenced",
      "2026-07-14T11:59:00.000Z",
      "Original"
    )
    const optimistic = createOptimisticMessage({
      nonce: "mobile-1",
      channelId: "channel-1",
      content: "Thread reply",
      author,
      threadRootId: "root-1",
      referencedMessage: {
        id: referenced.id,
        content: referenced.content,
        author: referenced.author,
        overrideName: null,
        overrideAvatarUrl: null,
      },
    })

    expect(optimistic.threadRootId).toBe("root-1")
    expect(optimistic.id).toBe("mobile-1")
    expect(optimistic.type).toBe("reply")
    expect(optimistic.referencedMessage?.content).toBe("Original")
  })

  it("keeps attachments on an optimistic attachment-only message", () => {
    const attachment = {
      url: "https://files.example.com/brief.pdf",
      filename: "brief.pdf",
      size: 4096,
      contentType: "application/pdf",
    }
    const optimistic = createOptimisticMessage({
      nonce: "mobile-attachment",
      channelId: "channel-1",
      content: null,
      author,
      attachments: [attachment],
    })

    expect(optimistic.content).toBeNull()
    expect(optimistic.attachments).toEqual([attachment])
  })

  it("keeps Merlin placeholders pending until the terminal stream arrives", () => {
    const message = {
      id: "merlin-1",
      channelId: "channel-1",
      content: null,
      type: "default" as const,
      createdAt: "2026-07-14T12:01:00.000Z",
      author,
      referencedMessage: null,
      attachments: [],
      embeds: [],
      pinned: false,
      mentions: [],
      reactions: [],
      threadRootId: "root-1",
      streaming: true,
    }

    expect(realtimeMessageToMessage(message).status).toBe("pending")
  })

  it("sets and clears channel thread summaries from exact realtime totals", () => {
    const root = makeMessage("root-1", "2026-07-14T12:00:00.000Z")
    const withSummary = applyThreadSummaryUpdate([root], makeThreadUpdate())[0]

    expect(withSummary?.threadSummary?.replyCount).toBe(2)
    expect(withSummary?.threadSummary?.participants).toHaveLength(1)

    const cleared = applyThreadSummaryUpdate(
      [withSummary as Message],
      makeThreadUpdate({ replyCount: 0, lastReplyAt: null, participants: [] })
    )[0]
    expect(cleared?.threadSummary).toBeNull()
  })

  it("rolls an optimistic reply back without disturbing confirmed replies", () => {
    const confirmed = makeMessage("confirmed", "2026-07-14T12:00:00.000Z")
    const optimistic = makeMessage("mobile-failed", "2026-07-14T12:01:00.000Z")

    const rollback = rollbackOptimisticReply(
      [optimistic, confirmed],
      optimistic.id,
      2
    )

    expect(rollback.messages).toEqual([confirmed])
    expect(rollback.totalReplyCount).toBe(1)
    expect(removeMessage(rollback.messages, "missing")).toEqual([confirmed])
  })

  it("applies exact reaction totals and current-user state", () => {
    const message = makeMessage("message-1", "2026-07-14T12:00:00.000Z")
    const updated = applyReactionUpdate(
      message,
      {
        channelId: "channel-1",
        messageId: message.id,
        emoji: "ship",
        count: 1,
        actorUserId: author.id,
        actorName: author.name,
        reactedByActor: true,
      },
      author.id
    )

    expect(updated.reactions).toEqual([
      {
        emoji: "ship",
        count: 1,
        reactedByCurrentUser: true,
        reactors: [{ id: author.id, name: author.name }],
      },
    ])
  })
})

describe("Merlin timeline helpers", () => {
  it("interleaves reasoning, tools, and answer text chronologically", () => {
    const segments = buildMerlinSegments(
      "Answer complete",
      [
        {
          toolCallId: "tool-1",
          toolName: "search_linear",
          label: "Searched Linear",
          at: 7,
          order: 2,
        },
      ],
      [{ text: "I should search", at: 0, order: 1 }]
    )

    expect(segments.map((segment) => segment.kind)).toEqual([
      "reasoning",
      "text",
      "tools",
      "text",
    ])
  })

  it("appends reasoning deltas to one ordered segment", () => {
    const message = makeMessage("merlin-1", "2026-07-14T12:00:00.000Z")
    const first = appendMerlinReasoning(message, {
      delta: "Checking ",
      at: 0,
      order: 1,
    })
    const second = appendMerlinReasoning(first, {
      delta: "sources",
      at: 0,
      order: 1,
    })

    expect(second.merlinReasoning).toBe("Checking sources")
    expect(second.merlinReasoningSegments).toEqual([
      { text: "Checking sources", at: 0, order: 1 },
    ])
  })

  it("upserts a completed tool call over its live placeholder", () => {
    const message = makeMessage("merlin-1", "2026-07-14T12:00:00.000Z")
    const pending = upsertMerlinToolCall(message, {
      toolCallId: "tool-1",
      toolName: "search_github",
      label: "Searching GitHub",
    })
    const complete = upsertMerlinToolCall(pending, {
      toolCallId: "tool-1",
      toolName: "search_github",
      label: "Searched GitHub",
      status: "ok",
      detail: { items: [{ title: "Result", url: "https://github.com/x" }] },
    })

    expect(complete.merlinToolCalls).toHaveLength(1)
    expect(complete.merlinToolCalls?.[0]?.status).toBe("ok")
  })
})
