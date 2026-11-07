import {
  AiMagicIcon,
  BubbleChatIcon,
  GitForkIcon,
  HashtagIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import {
  ArtifactFileCard,
  UploadFileCard,
} from "@/components/chat/artifact-file-card"
import { PlanStepList } from "@/components/chat/plan-step-list"
import {
  ReviewThreadRow,
  sendFixWithLor,
  threadFixItem,
} from "@/components/session/review-threads"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import type { SessionWorkSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { SessionPanelTabs } from "@/components/sidebar/right-panel/session-changes-panel"
import { SessionTouchedList } from "@/components/sidebar/right-panel/session-touched-list"
import { MorphText } from "@/components/ui/morph-text"
import { useSocket } from "@/context/socket-context"
import {
  type AgentSessionDetail,
  sessionFilesQueryOptions,
  sessionTouchesQueryOptions,
  useAgentSession,
} from "@/hooks/use-agent-session"
import { usePlanForThread } from "@/hooks/use-channel-plans"
import {
  useMessageIdNavigation,
  useMessageLocation,
} from "@/hooks/use-message-search-navigation"
import { useSessionReview } from "@/hooks/use-session-review"
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

// The session's details beside the session page: its starting context, what
// Lor touched, plan and files stay in view while the transcript scrolls (a
// code session, where this is the Details tab, shows no files). Lor's tool
// activity shows on its replies; approval and proposal cards render inline
// there too.
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
  const { data: detail } = useAgentSession(view.sessionId)
  // Code sessions: repo files have their own tab, and only Pi makes Lor's
  // plans (Claude Code and Codex keep their own task lists).
  const code = detail?.session.mode === "code"
  const showPlan = !code || detail?.session.harness === "pi"
  const { data: files } = useQuery({
    ...sessionFilesQueryOptions(view.sessionId),
    enabled: detail !== undefined && !code,
  })
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
  const hasContext = Boolean(
    detail && (detail.source || detail.context.length > 0)
  )
  const { data: touched, isError: touchedFailed } = useQuery(
    sessionTouchesQueryOptions(view.sessionId)
  )
  // Touches are recorded just after a run finishes; the worker announces
  // when they're saved.
  const socket = useSocket()
  useEffect(() => {
    if (!socket) return
    const onTouches = (payload: { threadRootId: string }) => {
      if (payload.threadRootId !== view.threadRootId) return
      // A first load still in flight would be reused, not refetched.
      const { queryKey } = sessionTouchesQueryOptions(view.sessionId)
      void queryClient
        .cancelQueries({ queryKey })
        .then(() => queryClient.invalidateQueries({ queryKey }))
    }
    socket.on("session:touches:updated", onTouches)
    return () => {
      socket.off("session:touches:updated", onTouches)
    }
  }, [socket, queryClient, view.sessionId, view.threadRootId])

  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title={code ? <SessionPanelTabs view={view} /> : "Details"}
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        hideBack
      />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        {detail && hasContext && (
          <PanelSection title="Context">
            {detail.source ? (
              <Link
                to="/$workspaceSlug/session/$sessionId"
                params={{
                  workspaceSlug: view.workspaceSlug,
                  sessionId: detail.source.id,
                }}
                search={
                  detail.session.forkedFromMessageId
                    ? { msgId: detail.session.forkedFromMessageId }
                    : {}
                }
                className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={
                    detail.session.forkedFromMessageId
                      ? GitForkIcon
                      : BubbleChatIcon
                  }
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
        {detail && (
          <PanelSection
            title="Touched"
            meta={
              touched && touched.items.length > 0
                ? String(touched.items.length)
                : undefined
            }
          >
            {touched && touched.items.length > 0 ? (
              <SessionTouchedList
                items={touched.items}
                workspaceSlug={view.workspaceSlug}
              />
            ) : (
              <PanelEmpty>
                {touched
                  ? "Nothing yet"
                  : touchedFailed
                    ? "Couldn't load"
                    : "Loading…"}
              </PanelEmpty>
            )}
          </PanelSection>
        )}
        {code && detail?.session.newBranch && (
          <SessionReviewSection
            sessionId={view.sessionId}
            threadRootId={view.threadRootId}
          />
        )}
        {showPlan && (
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
        )}
        {!code && (
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
        )}
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

// The open comments on the pull request of the session's own branch, across
// its reviews: the to-do list beside the review cards in the thread
// (reference/planned/pr-reviews.md).
function SessionReviewSection({
  sessionId,
  threadRootId,
}: {
  sessionId: string
  threadRootId: string
}) {
  const [showResolved, setShowResolved] = useState(false)
  const {
    data: review,
    isPending,
    isError,
  } = useSessionReview(sessionId, threadRootId)
  const threads = review?.threads ?? []
  const open = threads.filter((thread) => !thread.resolved)
  const resolvedCount = threads.length - open.length
  const shown = showResolved ? threads : open
  return (
    <PanelSection
      title={
        review ? (
          <a
            href={review.pullRequest.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 hover:text-foreground"
          >
            Review
            <span className="text-muted-foreground/70">
              #{review.pullRequest.number}
            </span>
          </a>
        ) : (
          "Review"
        )
      }
      meta={open.length > 0 ? `${open.length} open` : undefined}
    >
      {isPending ? (
        <PanelEmpty>Loading…</PanelEmpty>
      ) : isError ? (
        <PanelEmpty>Couldn't load from GitHub</PanelEmpty>
      ) : !review ? (
        <PanelEmpty>No pull request yet</PanelEmpty>
      ) : (
        <div className="-mx-2 flex flex-col gap-1">
          {open.length > 1 && (
            <Button
              size="xs"
              variant="outline"
              className="mx-2 self-start"
              onClick={() =>
                sendFixWithLor(
                  threadRootId,
                  open.map(threadFixItem),
                  review.pullRequest
                )
              }
            >
              <HugeiconsIcon icon={AiMagicIcon} className="size-3.5" />
              Fix all open
            </Button>
          )}
          {shown.map((thread) => (
            <ReviewThreadRow
              key={thread.id}
              thread={thread}
              onFix={() =>
                sendFixWithLor(
                  threadRootId,
                  [threadFixItem(thread)],
                  review.pullRequest
                )
              }
            />
          ))}
          {shown.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground/70">
              {threads.length === 0 ? "No review comments yet" : "All resolved"}
            </p>
          )}
          {resolvedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowResolved(!showResolved)}
              className="cursor-pointer self-start px-2 text-muted-foreground text-xs hover:text-foreground"
            >
              {showResolved
                ? "Hide resolved"
                : `Show ${resolvedCount} resolved`}
            </button>
          )}
        </div>
      )}
    </PanelSection>
  )
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
              Uploads
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
