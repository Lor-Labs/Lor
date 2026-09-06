import {
  Archive02Icon,
  BrainIcon,
  Calendar03Icon,
  HashtagIcon,
  Loading03Icon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ProjectArchiveProgressEvent } from "@repo/realtime-types/events"
import { Badge } from "@repo/ui/components/badge"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { MerlinToolTrail } from "@/components/chat/merlin-tool-trail"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { UserAvatar } from "@/components/ui/user-avatar"
import { useSocket } from "@/context/socket-context"
import { useProjectUpdates } from "@/hooks/use-project-updates"
import { apiClient } from "@/lib/api-client"
import type { MerlinToolCallView } from "@/lib/api-types"

export const Route = createFileRoute(
  "/_authenticated/$workspaceSlug/project/$projectId"
)({
  component: ProjectOverview,
})

type LiveMemory = {
  path: string
  action: "created" | "updated"
  nodeId?: string
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function MemoryChip({ memory }: { memory: LiveMemory }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 py-1 pr-2.5 pl-2 text-xs text-muted-foreground">
      <HugeiconsIcon
        icon={BrainIcon}
        className="size-3.5 shrink-0 text-primary"
        strokeWidth={2}
      />
      <span>
        {memory.action === "created" ? "Saved to memory" : "Updated memory"}
        <span className="ml-1.5 font-mono text-[11px] text-foreground/85">
          {memory.path}
        </span>
      </span>
    </span>
  )
}

function ProjectOverview() {
  const { workspaceSlug, projectId } = Route.useParams()
  const socket = useSocket()
  useProjectUpdates(workspaceSlug)

  const { data, isPending, isError } = useQuery({
    queryKey: ["project", workspaceSlug, projectId],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].projects[
        ":projectId"
      ].$get({ param: { workspaceSlug, projectId } })
      if (!res.ok) throw new Error("Project not found")
      return res.json()
    },
  })

  // Live synthesis progress: join the category channel room (normal access
  // check applies) and collect tool/memory frames while the archivist works.
  const [liveTools, setLiveTools] = useState<MerlinToolCallView[]>([])
  const [liveMemories, setLiveMemories] = useState<LiveMemory[]>([])
  const archiving = data?.status === "archiving"
  const categoryChannelId = data?.categoryChannelId

  // The route component persists across param changes — progress from a
  // previously viewed project must not bleed into this one.
  useEffect(() => {
    setLiveTools([])
    setLiveMemories([])
  }, [projectId])

  useEffect(() => {
    if (!socket || !archiving || !categoryChannelId) return
    // Re-join on every "connect" — rooms don't survive a reconnect.
    const join = () =>
      socket.emit("channel:join", { channelId: categoryChannelId })
    join()
    socket.on("connect", join)

    const onProgress = (payload: ProjectArchiveProgressEvent) => {
      if (payload.projectId !== projectId) return
      if (payload.toolCall) {
        const toolCall = payload.toolCall
        setLiveTools((prev) => {
          const idx = prev.findIndex(
            (t) => t.toolCallId === toolCall.toolCallId
          )
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = toolCall
            return next
          }
          return [...prev, toolCall]
        })
      }
      if (payload.memory) {
        const memory = payload.memory
        setLiveMemories((prev) => {
          const idx = prev.findIndex((m) => m.path === memory.path)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = memory
            return next
          }
          return [...prev, memory]
        })
      }
    }
    socket.on("project:archive:progress", onProgress)
    return () => {
      socket.off("project:archive:progress", onProgress)
      socket.off("connect", join)
      socket.emit("channel:leave", { channelId: categoryChannelId })
    }
  }, [socket, archiving, categoryChannelId, projectId])

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <HugeiconsIcon
          icon={Loading03Icon}
          className="size-5 animate-spin text-muted-foreground"
          strokeWidth={2}
        />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground">Project not found</span>
      </div>
    )
  }

  const archivedDate = formatDate(data.archivedAt)
  const memories = data.status === "archived" ? data.memories : liveMemories
  const topLevelTools = liveTools.filter((t) => !t.parentToolCallId)
  const childrenByParent = new Map<string, MerlinToolCallView[]>()
  for (const t of liveTools) {
    if (!t.parentToolCallId) continue
    const list = childrenByParent.get(t.parentToolCallId) ?? []
    list.push(t)
    childrenByParent.set(t.parentToolCallId, list)
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
            {archiving ? (
              <HugeiconsIcon
                icon={Loading03Icon}
                className="size-5 animate-spin"
                strokeWidth={2}
              />
            ) : (
              <HugeiconsIcon
                icon={Archive02Icon}
                className="size-5"
                strokeWidth={2}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{data.name}</h1>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              {archiving ? (
                <Badge variant="secondary">Archiving…</Badge>
              ) : data.status === "archived" ? (
                <Badge variant="secondary">
                  Archived{archivedDate ? ` ${archivedDate}` : ""}
                </Badge>
              ) : (
                <Badge variant="secondary">Active</Badge>
              )}
              <span className="inline-flex items-center gap-1">
                <HugeiconsIcon
                  icon={Calendar03Icon}
                  className="size-3.5"
                  strokeWidth={2}
                />
                Started {formatDate(data.createdAt)}
              </span>
              {data.targetDate && (
                <span>Target {formatDate(data.targetDate)}</span>
              )}
            </div>
          </div>
          <div className="flex -space-x-1.5">
            {data.members.slice(0, 6).map((m) => (
              <div key={m.id} className="rounded-full ring-2 ring-background">
                <UserAvatar src={m.image} name={m.name} size="sm" />
              </div>
            ))}
            {data.members.length > 6 && (
              <div className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
                +{data.members.length - 6}
              </div>
            )}
          </div>
        </div>

        {data.description && (
          <p className="mt-4 text-sm text-muted-foreground">
            {data.description}
          </p>
        )}

        {/* Summary — the closing artifact, or the live archivist while it works */}
        <div className="mt-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Summary
          </h2>
          <div className="mt-2 rounded-xl border border-border bg-card p-4">
            {archiving ? (
              <div className="text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    className="size-4 animate-spin"
                    strokeWidth={2}
                  />
                  Merlin is reviewing this project — reading the channels,
                  checking what shipped, and saving what matters.
                </div>
                {topLevelTools.length > 0 && (
                  <MerlinToolTrail
                    toolCalls={topLevelTools}
                    childrenByParent={childrenByParent}
                    streaming
                  />
                )}
              </div>
            ) : data.summary ? (
              <MessageMarkdown
                content={data.summary}
                mentions={[]}
                className="text-sm"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {data.status === "archived"
                  ? "No closing summary was produced for this project."
                  : "A closing summary will be written here when the project is archived."}
              </p>
            )}
          </div>
        </div>

        {/* Memory glance */}
        {memories.length > 0 && (
          <div className="mt-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Saved to memory
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {memories.map((m) => (
                <MemoryChip key={m.path} memory={m} />
              ))}
            </div>
          </div>
        )}

        {/* Channels — still browsable, read-only */}
        <div className="mt-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Channels
          </h2>
          <div className="mt-2 overflow-hidden rounded-xl border border-border">
            {data.channels.map((ch) => (
              <Link
                key={ch.id}
                to="/$workspaceSlug/$channelId"
                params={{ workspaceSlug, channelId: ch.id }}
                className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground last:border-b-0 hover:bg-foreground/[0.04] hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={ch.type === "voice" ? VolumeHighIcon : HashtagIcon}
                  className="size-4 shrink-0 opacity-60"
                  strokeWidth={2}
                />
                <span className="truncate">{ch.name}</span>
                {data.status !== "active" && (
                  <span className="ml-auto text-[11px] text-muted-foreground/60">
                    read-only
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
