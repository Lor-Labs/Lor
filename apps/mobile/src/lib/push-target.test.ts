import {
  buildNotificationTitle,
  buildReactionNotificationBody,
} from "@repo/realtime-types"
import { describe, expect, it } from "vitest"
import { parsePushTarget } from "./push-target"

describe("push notification targets", () => {
  it("preserves the exact message and thread destination", () => {
    expect(
      parsePushTarget({
        type: "reaction",
        channelId: "channel-1",
        workspaceId: "workspace-1",
        threadRootId: "thread-1",
        messageId: "message-1",
      })
    ).toEqual({
      kind: "message",
      channelId: "channel-1",
      workspaceId: "workspace-1",
      threadRootId: "thread-1",
      messageId: "message-1",
      sessionId: null,
    })
  })

  it("treats missing workspace and thread values as a DM target", () => {
    expect(
      parsePushTarget({
        type: "message",
        channelId: "dm-1",
        messageId: "message-1",
      })
    ).toEqual({
      kind: "message",
      channelId: "dm-1",
      workspaceId: null,
      threadRootId: null,
      messageId: "message-1",
      sessionId: null,
    })
  })

  it("rejects payloads without a destination", () => {
    expect(parsePushTarget({ type: "reaction", messageId: "message-1" })).toBe(
      null
    )
  })
})

describe("notification copy", () => {
  it("includes channel and workspace context in the title", () => {
    expect(
      buildNotificationTitle({
        actorName: "Jacob",
        channelName: "dev",
        workspaceName: "Lor",
      })
    ).toBe("Jacob (#dev, Lor)")
  })

  it("quotes a reaction message preview", () => {
    expect(
      buildReactionNotificationBody({
        emoji: "❤️",
        messagePreview: "ship it",
      })
    ).toBe('Reacted ❤️ to your "ship it"')
  })

  it("falls back cleanly when the message has no text", () => {
    expect(
      buildReactionNotificationBody({ emoji: "❤️", messagePreview: null })
    ).toBe("Reacted ❤️ to your message")
  })
})
