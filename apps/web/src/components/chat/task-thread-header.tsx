import { Button } from "@repo/ui/components/button"
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import { ChevronRight } from "lucide-react"
import { ArtifactFileCard } from "@/components/chat/artifact-file-card"
import { TaskPlanList } from "@/components/chat/task-plan-list"
import { useTaskForCard } from "@/hooks/use-channel-tasks"
import {
  type TaskApproval,
  useResolveApproval,
  useTask,
  useTaskArtifacts,
} from "@/hooks/use-task"
import { formatFileSize, getFileKind } from "@/lib/attachments"

export type TaskSourceFile = {
  url: string
  filename: string
  size: number
  contentType: string
}

function ApprovalCard({
  taskId,
  approval,
}: {
  taskId: string
  approval: TaskApproval
}) {
  const resolve = useResolveApproval(taskId)
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
      <p className="font-medium text-sm">Merlin asks for approval</p>
      <p className="mt-1 text-muted-foreground text-sm">
        {approval.description}
      </p>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          disabled={resolve.isPending}
          onClick={() =>
            resolve.mutate({ approvalId: approval.id, resolution: "approve" })
          }
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={resolve.isPending}
          onClick={() =>
            resolve.mutate({ approvalId: approval.id, resolution: "reject" })
          }
        >
          Reject
        </Button>
      </div>
    </div>
  )
}

const SECTION_TRIGGER_CLASS =
  "group flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground data-popup-open:bg-foreground/5 data-popup-open:text-foreground"

function SectionChevron() {
  return (
    <ChevronRight className="size-3 transition-transform group-data-popup-open:rotate-90" />
  )
}

function SourceRow({ source }: { source: TaskSourceFile }) {
  const kind = getFileKind(source.contentType, source.filename)
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-muted-foreground text-sm transition-colors hover:bg-foreground/5 hover:text-foreground"
    >
      <kind.Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{source.filename}</span>
      <span className="shrink-0 text-xs">{formatFileSize(source.size)}</span>
    </a>
  )
}

// Docked strip under the task panel header: Plan/Files popovers (the
// anti-lost-in-scroll anchors) plus the pending approval card, which is
// always visible. Outputs open the artifact viewer; sources are plain links —
// only artifacts are editable, and only artifacts open the takeover view.
export function TaskThreadHeader({
  channelId,
  cardMessageId,
  sources,
}: {
  channelId: string
  cardMessageId: string
  sources: TaskSourceFile[]
}) {
  const task = useTaskForCard(channelId, cardMessageId)
  const { data: detail } = useTask(task?.id ?? null)
  const { data: artifacts } = useTaskArtifacts(task?.id ?? null)

  if (!task) return null

  const pendingApproval =
    detail?.pendingApproval?.status === "pending"
      ? detail.pendingApproval
      : null
  const outputs = artifacts ?? []
  const doneCount = task.plan.filter((item) => item.status === "done").length
  const fileCount = outputs.length + sources.length
  const showPlan = task.plan.length > 0
  const showFiles = fileCount > 0

  if (!showPlan && !showFiles && !pendingApproval) return null

  return (
    <div className="shrink-0 border-b px-3 pb-2">
      {(showPlan || showFiles) && (
        <div className="-ml-0.5 flex items-center gap-1">
          {showPlan && (
            <Popover>
              <PopoverTrigger className={SECTION_TRIGGER_CLASS}>
                <SectionChevron />
                {`Plan · ${doneCount}/${task.plan.length}`}
              </PopoverTrigger>
              <PopoverPopup
                side="bottom"
                align="start"
                className="w-80"
                viewportClassName="p-3"
              >
                <TaskPlanList items={task.plan} />
              </PopoverPopup>
            </Popover>
          )}
          {showFiles && (
            <Popover>
              <PopoverTrigger className={SECTION_TRIGGER_CLASS}>
                <SectionChevron />
                {`Files · ${fileCount}`}
              </PopoverTrigger>
              <PopoverPopup
                side="bottom"
                align="start"
                className="w-80"
                viewportClassName="p-3"
              >
                <div className="space-y-2">
                  {outputs.length > 0 && (
                    <div className="space-y-1">
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
                          contentType={artifact.mime}
                          size={artifact.size}
                          variant="chip"
                          className="w-full max-w-none"
                        />
                      ))}
                    </div>
                  )}
                  {sources.length > 0 && (
                    <div className="space-y-0.5">
                      {outputs.length > 0 && (
                        <p className="px-1 font-medium text-muted-foreground text-xs">
                          Sources
                        </p>
                      )}
                      {sources.map((source) => (
                        <SourceRow key={source.url} source={source} />
                      ))}
                    </div>
                  )}
                </div>
              </PopoverPopup>
            </Popover>
          )}
        </div>
      )}
      {pendingApproval && (
        <div className="mt-2">
          <ApprovalCard taskId={task.id} approval={pendingApproval} />
        </div>
      )}
    </div>
  )
}
