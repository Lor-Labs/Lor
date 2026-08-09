import { File01Icon, MagicWand01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { useNavigate } from "@tanstack/react-router"
import { useTaskForCard } from "@/hooks/use-channel-tasks"
import {
  type TaskApproval,
  useResolveApproval,
  useTask,
  useTaskArtifacts,
} from "@/hooks/use-task"
import { formatFileSize } from "@/lib/attachments"
import { TASK_STATUS_META } from "@/lib/task-ui"

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

// Pinned task header at the top of a task thread: goal, status, plan,
// pending approval, and delivered artifacts (click one to open the viewer).
export function TaskThreadHeader({
  workspaceSlug,
  channelId,
  cardMessageId,
}: {
  workspaceSlug: string
  channelId: string
  cardMessageId: string
}) {
  const navigate = useNavigate()
  const task = useTaskForCard(channelId, cardMessageId)
  const { data: detail } = useTask(task?.id ?? null)
  const { data: artifacts } = useTaskArtifacts(task?.id ?? null)

  if (!task) return null
  const meta = TASK_STATUS_META[task.status]
  const pendingApproval =
    detail?.pendingApproval?.status === "pending"
      ? detail.pendingApproval
      : null

  const openArtifact = (artifactId: string) => {
    void navigate({
      to: "/$workspaceSlug/$channelId",
      params: { workspaceSlug, channelId },
      search: (prev) => ({ ...prev, artifactId }),
    })
  }

  return (
    <div className="max-h-72 shrink-0 space-y-2 overflow-y-auto border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={MagicWand01Icon}
          size={16}
          className="shrink-0 text-primary"
        />
        <span className="min-w-0 truncate font-medium text-sm">
          {task.title}
        </span>
        <Badge
          variant={meta.badgeVariant}
          size="sm"
          className="ml-auto shrink-0"
        >
          <HugeiconsIcon
            icon={meta.icon}
            size={12}
            className={meta.spin ? "animate-spin" : undefined}
          />
          {meta.label}
        </Badge>
      </div>
      {pendingApproval && (
        <ApprovalCard taskId={task.id} approval={pendingApproval} />
      )}
      {task.status === "completed" && task.summary && (
        <p className="text-muted-foreground text-sm">{task.summary}</p>
      )}
      {artifacts && artifacts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              onClick={() => openArtifact(artifact.id)}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-sm transition-colors hover:bg-accent/40"
            >
              <HugeiconsIcon
                icon={File01Icon}
                size={14}
                className="text-muted-foreground"
              />
              <span className="max-w-48 truncate">{artifact.path}</span>
              {artifact.size !== null && (
                <span className="text-muted-foreground text-xs">
                  {formatFileSize(artifact.size)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
