import { ArrowDown01Icon, HashtagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { SessionRail } from "@/components/session/session-rail"
import { ThreadPanel } from "@/components/sidebar/right-panel/thread-panel"
import {
  type AgentSessionDetail,
  useAgentSession,
} from "@/hooks/use-agent-session"
import { useChannelApprovals } from "@/hooks/use-approvals"
import { useChannelProposals } from "@/hooks/use-proposals"

export function SessionView({
  workspaceSlug,
  sessionId,
}: {
  workspaceSlug: string
  sessionId: string
}) {
  const { data, isPending, isError } = useAgentSession(sessionId)

  if (isPending || isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground">
          {isPending ? "Loading..." : "Session not found"}
        </span>
      </div>
    )
  }

  return (
    <SessionConversation
      key={data.session.id}
      workspaceSlug={workspaceSlug}
      detail={data}
    />
  )
}

function SessionConversation({
  workspaceSlug,
  detail: { session, channel, context },
}: {
  workspaceSlug: string
  detail: AgentSessionDetail
}) {
  // Approval and proposal cards render inline in the session; keep them live
  // here, since the channel page that also mounts these may not be open.
  useChannelApprovals(session.channelId)
  useChannelProposals(session.channelId)
  const channelName = channel.name ?? "channel"

  return (
    <ThreadPanel
      view={{
        type: "thread",
        workspaceSlug,
        channelId: session.channelId,
        threadRootId: session.threadRootId,
      }}
      sessionView={{
        header: (
          <SessionHeader
            title={session.title}
            workspaceSlug={workspaceSlug}
            channelId={session.channelId}
            channelName={channelName}
          />
        ),
        context:
          context.length > 0 ? (
            <SessionContextBlock channelName={channelName} messages={context} />
          ) : undefined,
        rail: (messages) => (
          <SessionRail
            channelId={session.channelId}
            threadRootId={session.threadRootId}
            messages={messages}
          />
        ),
      }}
    />
  )
}

function SessionHeader({
  title,
  workspaceSlug,
  channelId,
  channelName,
}: {
  title: string
  workspaceSlug: string
  channelId: string
  channelName: string
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <HeaderNavControls className="-ml-2" withDivider />
      <span className="truncate font-semibold">{title}</span>
      <Link
        to="/$workspaceSlug/$channelId"
        params={{ workspaceSlug, channelId }}
        className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <HugeiconsIcon
          icon={HashtagIcon}
          className="size-3.5"
          strokeWidth={2}
        />
        {channelName}
      </Link>
    </div>
  )
}

// The messages the session started with: what Lor was given as background.
function SessionContextBlock({
  channelName,
  messages,
}: {
  channelName: string
  messages: AgentSessionDetail["context"]
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-border/70 bg-foreground/[0.02]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <HugeiconsIcon
          icon={HashtagIcon}
          className="size-3.5"
          strokeWidth={2}
        />
        From #{channelName} · {messages.length}{" "}
        {messages.length === 1 ? "message" : "messages"}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className={cn(
            "ml-auto size-3.5 transition-transform",
            !open && "-rotate-90"
          )}
          strokeWidth={2}
        />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border/70 px-3 py-2">
          {messages.map((message) => (
            <p key={message.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {message.authorName}
              </span>{" "}
              {message.text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
