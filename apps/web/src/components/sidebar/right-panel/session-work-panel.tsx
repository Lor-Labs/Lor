import { BubbleChatIcon, HashtagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "@repo/ui/components/toast"
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useMemo } from "react"
import {
  ArtifactFileCard,
  UploadFileCard,
} from "@/components/chat/artifact-file-card"
import { PlanStepList } from "@/components/chat/plan-step-list"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import type { SessionWorkSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { MorphText } from "@/components/ui/morph-text"
import {
  type AgentSessionDetail,
  sessionFilesQueryOptions,
  useAgentSession,
} from "@/hooks/use-agent-session"
import { usePlanForThread } from "@/hooks/use-channel-plans"
import {
  useMessageIdNavigation,
  useMessageLocation,
} from "@/hooks/use-message-search-navigation"
import {
  fetchThreadPage,
  type ThreadPage,
  threadQueryOptions,
} from "@/hooks/use-thread-messages"

type OutputFile = { id: string; path: string; size: number | null }
type SourceFile = {
  url: string
  filename: string
  size: number
  messageId: string
  index: number
}

// Files from the loaded session messages, walked oldest first so a file Lor
// rewrote keeps its latest version and moves to the top.
function collectSessionWork(pages: ThreadPage[]) {
  const messages = pages
    .flatMap((page) => page.data)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  const outputs = new Map<string, OutputFile>()
  const sources = new Map<string, SourceFile>()
  for (const message of messages) {
    for (const call of message.lorToolCalls ?? []) {
      for (const file of call.files ?? []) {
        outputs.delete(file.artifactId)
        outputs.set(file.artifactId, {
          id: file.artifactId,
          path: file.path,
          size: file.size,
        })
      }
    }
    for (const [index, attachment] of (message.attachments ?? []).entries()) {
      sources.set(attachment.url, {
        url: attachment.url,
        filename: attachment.filename,
        size: attachment.size,
        messageId: message.id,
        index,
      })
    }
  }
  return {
    outputs: [...outputs.values()].reverse(),
    sources: [...sources.values()],
  }
}

// The session's details beside the session page: its starting context, plan
// and files stay in view while the transcript scrolls. Lor's tool activity
// shows on its replies; approval and proposal cards render inline there too.
export function SessionWorkPanel({ view }: { view: SessionWorkSidebarView }) {
  const queryClient = useQueryClient()
  // Same query as the session page, so it shares the cache, live replies and
  // streaming.
  const { data } = useInfiniteQuery(
    threadQueryOptions(queryClient, view.threadRootId, (params) =>
      fetchThreadPage(view, params)
    )
  )
  const { outputs: liveOutputs, sources: liveSources } = useMemo(
    () => collectSessionWork(data?.pages ?? []),
    [data]
  )
  const { data: files } = useQuery(sessionFilesQueryOptions(view.sessionId))
  const plan = usePlanForThread(view.channelId, view.threadRootId)
  const doneCount = !plan
    ? 0
    : plan.status === "completed"
      ? plan.steps.length
      : plan.steps.filter((item) => item.status === "done").length

  // The API lists every file in the session; loaded messages add files that
  // landed since it was fetched, at their newest version.
  const outputs = useMemo(() => {
    const byId = new Map(liveOutputs.map((file) => [file.id, file]))
    for (const file of files?.outputs ?? []) {
      if (!byId.has(file.id)) byId.set(file.id, file)
    }
    return [...byId.values()]
  }, [liveOutputs, files])
  const sources = useMemo(() => {
    const byUrl = new Map<string, SourceFile>(
      files?.sources.map((file) => [file.url, file])
    )
    for (const file of liveSources) {
      if (!byUrl.has(file.url)) byUrl.set(file.url, file)
    }
    return [...byUrl.values()]
  }, [liveSources, files])
  const fileCount = outputs.length + sources.length
  const steps = plan?.steps ?? []
  const { data: detail } = useAgentSession(view.sessionId)

  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title="Details"
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        hideBack
      />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        {detail && (detail.source || detail.context.length > 0) && (
          <PanelSection title="Context">
            {detail.source ? (
              <Link
                to="/$workspaceSlug/session/$sessionId"
                params={{
                  workspaceSlug: view.workspaceSlug,
                  sessionId: detail.source.id,
                }}
                className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={BubbleChatIcon}
                  className="size-3.5 shrink-0"
                  strokeWidth={2}
                />
                <span className="min-w-0 truncate">{detail.source.title}</span>
              </Link>
            ) : (
              <ContextLink
                channelName={detail.channel.name ?? "channel"}
                messages={detail.context}
              />
            )}
          </PanelSection>
        )}
        <PanelSection
          title="Plan"
          meta={
            steps.length > 0 ? (
              <MorphText>{`${doneCount}/${steps.length}`}</MorphText>
            ) : undefined
          }
        >
          {steps.length > 0 ? (
            <PlanStepList items={steps} />
          ) : (
            <PanelEmpty>No plan yet</PanelEmpty>
          )}
        </PanelSection>
        <PanelSection
          title="Files"
          meta={fileCount > 0 ? String(fileCount) : undefined}
        >
          {fileCount > 0 ? (
            <SessionFileList outputs={outputs} sources={sources} />
          ) : (
            <PanelEmpty>No files yet</PanelEmpty>
          )}
        </PanelSection>
      </div>
    </div>
  )
}

function PanelSection({
  title,
  meta,
  children,
}: {
  title: ReactNode
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {title}
        {meta && <span className="text-muted-foreground/70">{meta}</span>}
      </h3>
      {children}
    </section>
  )
}

// The messages the session started with (what Lor was given as background),
// as a link to where they were said rather than a copy.
function ContextLink({
  channelName,
  messages,
}: {
  channelName: string
  messages: AgentSessionDetail["context"]
}) {
  const goToMessage = useMessageIdNavigation()
  const { prefetch } = useMessageLocation()
  const newest = messages.at(-1)
  if (!newest) return null

  const open = () =>
    void goToMessage(newest.id)
      .then((found) => {
        if (!found) toast.error("Couldn't find that conversation")
      })
      .catch(() => toast.error("Couldn't open that conversation"))

  return (
    <button
      type="button"
      onClick={open}
      onPointerEnter={() => prefetch(newest.id)}
      className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
    >
      <HugeiconsIcon
        icon={HashtagIcon}
        className="size-3.5 shrink-0"
        strokeWidth={2}
      />
      <span className="min-w-0 truncate">{channelName}</span>
      <span className="shrink-0 text-xs">
        {messages.length} {messages.length === 1 ? "message" : "messages"}
      </span>
    </button>
  )
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground/70">{children}</p>
}

function SessionFileList({
  outputs,
  sources,
}: {
  outputs: OutputFile[]
  sources: SourceFile[]
}) {
  return (
    <div className="space-y-2">
      {outputs.length > 0 && (
        <div className="space-y-1.5">
          {sources.length > 0 && (
            <p className="px-1 font-medium text-muted-foreground text-xs">
              Outputs
            </p>
          )}
          {outputs.map((artifact) => (
            <ArtifactFileCard
              key={artifact.id}
              artifactId={artifact.id}
              name={artifact.path}
              size={artifact.size}
              className="w-full"
            />
          ))}
        </div>
      )}
      {sources.length > 0 && (
        <div className="space-y-1.5">
          {outputs.length > 0 && (
            <p className="px-1 font-medium text-muted-foreground text-xs">
              Sources
            </p>
          )}
          {sources.map((source) => (
            <UploadFileCard
              key={source.url}
              name={source.filename}
              size={source.size}
              messageId={source.messageId}
              index={source.index}
              className="w-full"
            />
          ))}
        </div>
      )}
    </div>
  )
}
