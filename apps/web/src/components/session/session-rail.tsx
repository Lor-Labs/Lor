import { LOR_USER_ID } from "@repo/db/constants"
import { type ReactNode, useMemo } from "react"
import { LorToolTrail } from "@/components/chat/lor-tool-trail"
import { PlanStepList } from "@/components/chat/plan-step-list"
import {
  type PlanSourceFile,
  useThreadWork,
  WorkFileList,
  type WorkOutputFile,
} from "@/components/chat/thread-work-header"
import { MorphText } from "@/components/ui/morph-text"
import type { Message } from "@/lib/api-types"

// Files and the newest tool trail from the loaded session messages
// (newest first). Walked oldest first so a file Lor rewrote keeps its latest
// version and moves to the top.
function collectSessionWork(messages: Message[]) {
  let activityMessage: Message | null = null
  const outputs = new Map<string, WorkOutputFile>()
  const sources = new Map<string, PlanSourceFile>()
  for (const message of [...messages].reverse()) {
    const toolCalls = message.lorToolCalls ?? []
    if (message.authorId === LOR_USER_ID && toolCalls.length > 0) {
      activityMessage = message
    }
    for (const call of toolCalls) {
      for (const file of call.files ?? []) {
        outputs.delete(file.artifactId)
        outputs.set(file.artifactId, {
          id: file.artifactId,
          path: file.path,
          mime: file.contentType,
          size: file.size,
        })
      }
    }
    for (const attachment of message.attachments ?? []) {
      sources.set(attachment.url, {
        url: attachment.url,
        filename: attachment.filename,
        size: attachment.size,
        contentType: attachment.contentType,
      })
    }
  }
  return {
    activityMessage,
    outputs: [...outputs.values()].reverse(),
    sources: [...sources.values()],
  }
}

// The session's work surface beside the conversation: plan, files and Lor's
// latest activity stay in view while the transcript scrolls. Approval and
// proposal cards render inline in the transcript, not here.
export function SessionRail({
  channelId,
  threadRootId,
  messages,
}: {
  channelId: string
  threadRootId: string
  messages: Message[]
}) {
  const {
    activityMessage,
    outputs: toolOutputs,
    sources,
  } = useMemo(() => collectSessionWork(messages), [messages])
  const {
    plan,
    outputs: planOutputs,
    doneCount,
    activityCalls,
    childrenByParent,
    streaming,
  } = useThreadWork(channelId, threadRootId, activityMessage)

  // Plan artifacts can predate the loaded messages; tool-call files cover
  // artifacts made without a plan.
  const outputs = useMemo(() => {
    const byId = new Map(toolOutputs.map((file) => [file.id, file]))
    for (const artifact of planOutputs) {
      if (!byId.has(artifact.id)) byId.set(artifact.id, artifact)
    }
    return [...byId.values()]
  }, [toolOutputs, planOutputs])
  const fileCount = outputs.length + sources.length
  const steps = plan?.steps ?? []

  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-6 overflow-y-auto border-l border-border px-4 py-4 @4xl:flex">
      <RailSection
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
          <RailEmpty>No plan yet</RailEmpty>
        )}
      </RailSection>
      <RailSection
        title="Files"
        meta={fileCount > 0 ? String(fileCount) : undefined}
      >
        {fileCount > 0 ? (
          <WorkFileList outputs={outputs} sources={sources} />
        ) : (
          <RailEmpty>No files yet</RailEmpty>
        )}
      </RailSection>
      <RailSection
        title={
          streaming ? <span className="shimmer">Working…</span> : "Activity"
        }
      >
        {activityCalls.length > 0 ? (
          <LorToolTrail
            toolCalls={activityCalls}
            childrenByParent={childrenByParent}
            streaming={streaming}
            embedded
          />
        ) : (
          <RailEmpty>No activity yet</RailEmpty>
        )}
      </RailSection>
    </aside>
  )
}

function RailSection({
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

function RailEmpty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground/70">{children}</p>
}
