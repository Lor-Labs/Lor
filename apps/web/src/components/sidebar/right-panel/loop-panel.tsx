import {
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Delete02Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilEdit01Icon,
  PlayIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  describeLoopSchedule,
  formatLoopSchedule,
  formatScheduleTime,
  type LoopScheduleShape,
  parseLoopSchedule,
} from "@repo/realtime-types/loops"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { cn } from "@repo/ui/lib/utils"
import { useMemo, useRef, useState } from "react"
import { ArtifactFileCard } from "@/components/chat/artifact-file-card"
import {
  LoopFrequencyDialog,
  useActivateLoop,
  useDeleteLoop,
  useLoopLifecycle,
  useUpdateLoop,
} from "@/components/loops/loop-actions"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { LoopSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import {
  type ChannelLoop,
  type LoopRun,
  useChannelLoops,
  useLoopRuns,
} from "@/hooks/use-channel-loops"
import { LOOP_PAUSED_REASON_LABEL, LOOP_STATUS_META } from "@/lib/loop-ui"
import { TASK_STATUS_META } from "@/lib/task-ui"

// Loop detail panel (ChatGPT-scheduled-tasks inspired): the card in chat is
// a compact pill; everything else lives here — the editable prompt, a
// structured schedule editor (Repeat / day / time Selects that round-trip
// the cron via parseLoopSchedule; live loops re-confirm tightened sub-hourly
// cadences), the timezone (pinned at activation), next/last run, and the
// run history. Completed loops are read-only.

function formatRunTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

const REPEAT_OPTIONS = [
  { label: "Hourly", value: "hourly" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
] as const

const DOW_OPTIONS = [
  { label: "Weekdays", value: "1-5" },
  { label: "Weekends", value: "0,6" },
  { label: "Sunday", value: "0" },
  { label: "Monday", value: "1" },
  { label: "Tuesday", value: "2" },
  { label: "Wednesday", value: "3" },
  { label: "Thursday", value: "4" },
  { label: "Friday", value: "5" },
  { label: "Saturday", value: "6" },
]

const MINUTE_OPTIONS = [0, 15, 30, 45]

// Half-hour slots; an unaligned time already on the loop is merged in so the
// Select never shows an empty value.
function timeOptions(current: { hour: number; minute: number }) {
  const slots: { label: string; value: string }[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      slots.push({ label: formatScheduleTime(h, m), value: `${h}:${m}` })
    }
  }
  const currentValue = `${current.hour}:${current.minute}`
  if (!slots.some((s) => s.value === currentValue)) {
    slots.push({
      label: formatScheduleTime(current.hour, current.minute),
      value: currentValue,
    })
  }
  return slots
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
      {children}
    </p>
  )
}

// The standing brief, editable in place on non-completed loops — click the
// card to edit, blur saves (Escape cancels). Every run reads it fresh, so a
// save takes effect from the next fire.
function PromptSection({
  loop,
  onSave,
  saving,
}: {
  loop: ChannelLoop
  onSave: (instructions: string) => void
  saving: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const cancelled = useRef(false)
  const editable = loop.status !== "completed" && !saving

  const commit = () => {
    setEditing(false)
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const trimmed = draft.trim()
    if (trimmed && trimmed !== loop.instructions) onSave(trimmed)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionLabel>Prompt</SectionLabel>
        {saving && (
          <span className="px-1 text-muted-foreground/70 text-xs">Saving…</span>
        )}
      </div>
      {editing ? (
        // Raw textarea styled byte-identical to the view card (same padding,
        // radius, type scale) so entering/leaving edit never shifts layout;
        // field-sizing-content auto-grows it with the text.
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              cancelled.current = true
              e.currentTarget.blur()
            }
          }}
          maxLength={4000}
          // biome-ignore lint/a11y/noAutofocus: edit mode is entered by an explicit click; focus must follow for blur-to-save to work
          autoFocus
          className="field-sizing-content w-full resize-none rounded-xl border border-ring bg-card px-4 py-3.5 text-sm leading-6 outline-none ring-[3px] ring-ring/24"
        />
      ) : (
        <button
          type="button"
          disabled={!editable}
          aria-label="Edit prompt"
          onClick={() => {
            setDraft(loop.instructions)
            setEditing(true)
          }}
          className={cn(
            "w-full rounded-xl border bg-card px-4 py-3.5 text-left transition-[opacity,border-color]",
            editable && "cursor-text hover:border-foreground/25",
            saving && "opacity-60"
          )}
        >
          <p className="whitespace-pre-wrap break-words text-sm leading-6">
            {loop.instructions}
          </p>
        </button>
      )}
    </div>
  )
}

const RUN_STATE_META: Record<
  LoopRun["state"],
  {
    label: string
    badgeVariant: "info" | "success" | "error" | "secondary"
    icon: typeof Clock01Icon
    spin?: boolean
  }
> = {
  queued: { label: "Queued", badgeVariant: "secondary", icon: Clock01Icon },
  working: {
    label: "Running",
    badgeVariant: "info",
    icon: Loading03Icon,
    spin: true,
  },
  finalizing: {
    label: "Running",
    badgeVariant: "info",
    icon: Loading03Icon,
    spin: true,
  },
  complete: {
    label: "Completed",
    badgeVariant: "success",
    icon: CheckmarkCircle02Icon,
  },
  failed: { label: "Failed", badgeVariant: "error", icon: AlertCircleIcon },
  stopped: { label: "Stopped", badgeVariant: "secondary", icon: Cancel01Icon },
}

// One run in the history: collapsed = time + outcome (+ one-line note
// preview); expanded = the full closing note, recorded actions, stop reason,
// and whatever the run spawned (task rows open their thread; artifact chips).
function LoopRunRow({ run, view }: { run: LoopRun; view: LoopSidebarView }) {
  const { setView, isCollapsed, toggleCollapsed } = useRightSidebar()
  const [expanded, setExpanded] = useState(false)
  const meta = RUN_STATE_META[run.state]
  const hasDetail =
    Boolean(run.note) ||
    run.effects.length > 0 ||
    run.tasks.length > 0 ||
    run.artifacts.length > 0 ||
    Boolean(run.stopReason && run.stopReason !== "completed")

  const openTaskThread = (cardMessageId: string) => {
    setView({
      type: "thread",
      workspaceSlug: view.workspaceSlug,
      channelId: view.channelId,
      threadRootId: cardMessageId,
    })
    if (isCollapsed) toggleCollapsed()
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        className={cnRunRow(hasDetail)}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm leading-5">
            {formatRunTime(run.scheduledFor ?? run.createdAt)}
          </p>
          {!expanded && run.note && (
            <p className="truncate text-muted-foreground text-xs leading-4">
              {run.note}
            </p>
          )}
        </div>
        <Badge variant={meta.badgeVariant} size="sm" className="shrink-0">
          <HugeiconsIcon
            icon={meta.icon}
            size={12}
            className={meta.spin ? "animate-spin" : undefined}
          />
          {meta.label}
        </Badge>
      </button>

      {expanded && (
        <div className="space-y-3 px-4 pb-3.5">
          {run.stopReason && run.stopReason !== "completed" && (
            <p className="text-muted-foreground text-xs">
              Stopped: {run.stopReason.replace(/_/g, " ")}
            </p>
          )}
          {run.note && (
            <p className="whitespace-pre-wrap break-words text-muted-foreground text-sm leading-6">
              {run.note}
            </p>
          )}
          {run.effects.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Actions: {run.effects.join(", ")}
            </p>
          )}
          {run.tasks.length > 0 && (
            <div className="space-y-1">
              {run.tasks.map((task) => {
                const taskMeta = TASK_STATUS_META[task.status]
                return (
                  <button
                    key={task.id}
                    type="button"
                    disabled={!task.cardMessageId}
                    onClick={() => {
                      if (task.cardMessageId) openTaskThread(task.cardMessageId)
                    }}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg bg-secondary/60 px-3 py-2 text-left ring-1 ring-border/40 ring-inset transition-colors hover:bg-secondary disabled:cursor-default"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {task.title}
                    </span>
                    <Badge
                      variant={taskMeta.badgeVariant}
                      size="sm"
                      className="shrink-0"
                    >
                      <HugeiconsIcon
                        icon={taskMeta.icon}
                        size={12}
                        className={taskMeta.spin ? "animate-spin" : undefined}
                      />
                      {taskMeta.label}
                    </Badge>
                  </button>
                )
              })}
            </div>
          )}
          {run.artifacts.length > 0 && (
            <div className="grid grid-cols-1 gap-2">
              {run.artifacts.map((artifact) => (
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
        </div>
      )}
    </div>
  )
}

function cnRunRow(clickable: boolean) {
  return `flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${
    clickable
      ? "cursor-pointer transition-colors hover:bg-foreground/[0.03]"
      : "cursor-default"
  }`
}

// Matches the header's built-in collapse button styling.
function HeaderActionButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string
  icon: typeof PauseIcon
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      <HugeiconsIcon icon={icon} size={16} />
    </button>
  )
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
      <span className="shrink-0 text-sm">{label}</span>
      <span className="flex min-w-0 items-center justify-end text-right text-muted-foreground text-sm">
        {children}
      </span>
    </div>
  )
}

// The schedule editor rows (drafts + live loops; completed is read-only).
// Every change formats a fresh cron and hands it to the parent, which owns
// the PATCH (and the tightened-cadence confirm dialog). Kind switches carry
// the current time over and default the new fields.
function ScheduleEditor({
  loop,
  onApply,
}: {
  loop: ChannelLoop
  onApply: (schedule: string) => void
}) {
  const shape = parseLoopSchedule(loop.schedule)

  if (shape.kind === "custom") {
    // Merlin proposed something the structured editor can't round-trip
    // (e.g. "*/20 * * * *") — show it, don't offer edits that would clobber it.
    return (
      <DetailRow label="Repeat">
        {describeLoopSchedule(loop.schedule, null)}
      </DetailRow>
    )
  }

  const apply = (next: LoopScheduleShape) => onApply(formatLoopSchedule(next))

  const hour = "hour" in shape ? shape.hour : 9
  const minute = shape.minute
  const changeKind = (kind: string) => {
    if (kind === shape.kind) return
    if (kind === "hourly") apply({ kind: "hourly", minute })
    if (kind === "daily") apply({ kind: "daily", hour, minute })
    if (kind === "weekly") apply({ kind: "weekly", dow: "1", hour, minute })
    if (kind === "monthly") apply({ kind: "monthly", dom: 1, hour, minute })
  }

  const minutes = MINUTE_OPTIONS.includes(minute)
    ? MINUTE_OPTIONS
    : [...MINUTE_OPTIONS, minute].sort((a, b) => a - b)
  const minuteItems = minutes.map((m) => ({
    label: `:${String(m).padStart(2, "0")}`,
    value: String(m),
  }))
  const timeItems = timeOptions({ hour, minute })
  const domItems = Array.from({ length: 31 }, (_, i) => ({
    label: String(i + 1),
    value: String(i + 1),
  }))

  return (
    <>
      <DetailRow label="Repeat">
        <Select
          items={[...REPEAT_OPTIONS]}
          value={shape.kind}
          onValueChange={(v) => v && changeKind(v)}
        >
          <SelectTrigger aria-label="Repeat" className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPEAT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DetailRow>

      {shape.kind === "weekly" && (
        <DetailRow label="Day of the week">
          <Select
            items={DOW_OPTIONS}
            value={shape.dow}
            onValueChange={(v) => v && apply({ ...shape, dow: v })}
          >
            <SelectTrigger aria-label="Day of the week" className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOW_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DetailRow>
      )}

      {shape.kind === "monthly" && (
        <DetailRow label="Day of the month">
          <Select
            items={domItems}
            value={String(shape.dom)}
            onValueChange={(v) => v && apply({ ...shape, dom: Number(v) })}
          >
            <SelectTrigger aria-label="Day of the month" className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {domItems.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DetailRow>
      )}

      {shape.kind === "hourly" ? (
        <DetailRow label="At minute">
          <Select
            items={minuteItems}
            value={String(minute)}
            onValueChange={(v) => v && apply({ ...shape, minute: Number(v) })}
          >
            <SelectTrigger aria-label="At minute" className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {minuteItems.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DetailRow>
      ) : (
        <DetailRow label="Time">
          <Select
            items={timeItems}
            value={`${hour}:${minute}`}
            onValueChange={(v) => {
              if (!v) return
              const [h = "0", m = "0"] = v.split(":")
              apply({ ...shape, hour: Number(h), minute: Number(m) })
            }}
          >
            <SelectTrigger aria-label="Time" className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timeItems.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DetailRow>
      )}
    </>
  )
}

export function LoopPanel({ view }: { view: LoopSidebarView }) {
  const { setView } = useRightSidebar()
  const { data } = useChannelLoops(view.channelId)
  const loop = data?.find((l) => l.id === view.loopId) ?? null
  const { data: runs, isPending: runsPending } = useLoopRuns(
    loop && loop.status !== "draft" ? loop.id : null
  )

  const deviceTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  )
  const [selectedTimezone, setSelectedTimezone] = useState<string | null>(null)
  const timezone = selectedTimezone ?? loop?.timezone ?? deviceTimezone
  const timezoneItems = useMemo(() => {
    const supported =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : [deviceTimezone]
    const all = supported.includes(timezone)
      ? supported
      : [timezone, ...supported]
    return all.map((tz) => ({ label: tz.replace(/_/g, " "), value: tz }))
  }, [deviceTimezone, timezone])
  const { activate, isPending, confirmFires, dismissConfirm } = useActivateLoop(
    loop,
    timezone
  )
  const lifecycle = useLoopLifecycle(loop)
  const updateLoop = useUpdateLoop(loop)
  const deleteLoop = useDeleteLoop(loop)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Null = rename dialog closed; a string is the draft being edited.
  const [nameDraft, setNameDraft] = useState<string | null>(null)

  const meta = loop ? LOOP_STATUS_META[loop.status] : null
  const scheduleText = loop ? describeLoopSchedule(loop.schedule, null) : ""
  const isDraft = loop?.status === "draft"
  // Hourly cadence reads the same in every timezone — the row is just noise.
  const isHourly = loop
    ? parseLoopSchedule(loop.schedule).kind === "hourly"
    : false

  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title={loop?.name ?? "Loop"}
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        hideCollapse
        titleAdornment={
          meta ? (
            <Badge variant={meta.badgeVariant} size="sm" className="shrink-0">
              {meta.label}
            </Badge>
          ) : undefined
        }
        actions={
          loop ? (
            <>
              {loop.status === "active" && (
                <HeaderActionButton
                  label="Pause loop"
                  icon={PauseIcon}
                  disabled={lifecycle.isPending}
                  onClick={() => lifecycle.mutate("pause")}
                />
              )}
              {loop.status === "paused" && (
                <HeaderActionButton
                  label="Resume loop"
                  icon={PlayIcon}
                  disabled={lifecycle.isPending}
                  onClick={() => lifecycle.mutate("resume")}
                />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Loop options"
                      disabled={lifecycle.isPending || deleteLoop.isPending}
                      className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    />
                  }
                >
                  <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {loop.status !== "completed" && (
                    <DropdownMenuItem onClick={() => setNameDraft(loop.name)}>
                      <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
                      Rename
                    </DropdownMenuItem>
                  )}
                  {(loop.status === "active" || loop.status === "paused") && (
                    <DropdownMenuItem onClick={() => setConfirmComplete(true)}>
                      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
                      Mark completed
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={14} />
                    Delete loop
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : undefined
        }
      />
      {!loop ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
          <p className="text-muted-foreground text-sm">
            This loop is no longer available.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
          <PromptSection
            loop={loop}
            saving={updateLoop.isPending}
            onSave={(instructions) => updateLoop.update({ instructions })}
          />

          <div className="space-y-2">
            <SectionLabel>Schedule</SectionLabel>
            <div className="divide-y divide-border/70 rounded-xl border bg-card">
              {loop.status === "completed" ? (
                <DetailRow label="Repeat">{scheduleText}</DetailRow>
              ) : (
                <ScheduleEditor
                  loop={loop}
                  onApply={(schedule) => updateLoop.update({ schedule })}
                />
              )}
              {!isHourly && (
                <DetailRow label="Timezone">
                  {isDraft ? (
                    <Select
                      items={timezoneItems}
                      value={timezone}
                      onValueChange={(v) => v && setSelectedTimezone(v)}
                    >
                      <SelectTrigger
                        aria-label="Timezone"
                        disabled={isPending}
                        className="h-8 max-w-56"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {timezoneItems.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>
                            {tz.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    (loop.timezone ?? "—")
                  )}
                </DetailRow>
              )}
              <DetailRow label="End repeat">
                {loop.endCondition ? (
                  <span className="truncate" title={loop.endCondition}>
                    {loop.endCondition}
                  </span>
                ) : (
                  "Never"
                )}
              </DetailRow>
              {loop.status === "active" && loop.nextRunAt && (
                <DetailRow label="Next run">
                  {formatRunTime(loop.nextRunAt)}
                </DetailRow>
              )}
              {loop.lastRunAt && (
                <DetailRow label="Last run">
                  {formatRunTime(loop.lastRunAt)}
                </DetailRow>
              )}
              {loop.status === "paused" && (
                <DetailRow label="Paused">
                  {(loop.pausedReason &&
                    LOOP_PAUSED_REASON_LABEL[loop.pausedReason]) ??
                    "Paused"}
                </DetailRow>
              )}
            </div>
          </div>

          {loop.status === "completed" && loop.completedNote && (
            <div className="space-y-2">
              <SectionLabel>Closing note</SectionLabel>
              <div className="rounded-xl border bg-card px-4 py-3.5">
                <p className="whitespace-pre-wrap break-words text-muted-foreground text-sm leading-6">
                  {loop.completedNote}
                </p>
              </div>
            </div>
          )}

          {loop.status !== "draft" && (
            <div className="space-y-2">
              <SectionLabel>Recent runs</SectionLabel>
              <div className="divide-y divide-border/70 rounded-xl border bg-card">
                {runsPending && (
                  <p className="px-4 py-3.5 text-muted-foreground text-sm">
                    Loading…
                  </p>
                )}
                {runs && runs.length === 0 && (
                  <p className="px-4 py-3.5 text-muted-foreground text-sm">
                    No runs yet.
                  </p>
                )}
                {runs?.map((run) => (
                  <LoopRunRow key={run.id} run={run} view={view} />
                ))}
              </div>
            </div>
          )}

          {isDraft && (
            <Button
              className="w-full"
              loading={isPending}
              onClick={() => activate()}
            >
              Create Loop
            </Button>
          )}
        </div>
      )}

      <LoopFrequencyDialog
        scheduleText={scheduleText}
        firesPerDay={confirmFires}
        onConfirm={() => activate({ confirm: true })}
        onDismiss={dismissConfirm}
      />

      {/* Schedule-edit confirm: the new cadence, not the loop's current one. */}
      <LoopFrequencyDialog
        scheduleText={
          updateLoop.confirmState?.input.schedule
            ? describeLoopSchedule(updateLoop.confirmState.input.schedule, null)
            : scheduleText
        }
        firesPerDay={updateLoop.confirmState?.firesPerDay ?? null}
        onConfirm={() => {
          if (updateLoop.confirmState) {
            updateLoop.update({
              ...updateLoop.confirmState.input,
              confirm: true,
            })
          }
        }}
        onDismiss={updateLoop.dismissConfirm}
      />

      <AlertDialog open={confirmComplete} onOpenChange={setConfirmComplete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this loop completed?</AlertDialogTitle>
            <AlertDialogDescription>
              Completing is permanent — the loop never runs again. Pause it
              instead if you might want it back later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              onClick={() => {
                setConfirmComplete(false)
                lifecycle.mutate("complete")
              }}
            >
              Mark completed
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this loop?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the loop and its card from the channel permanently.
              Past run activity stays in the channel history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={deleteLoop.isPending}
              onClick={() =>
                deleteLoop.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmDelete(false)
                    // The loop is gone — land back on the channel overview.
                    setView({
                      type: "workspace-members",
                      workspaceSlug: view.workspaceSlug,
                      channelId: view.channelId,
                    })
                  },
                })
              }
            >
              Delete loop
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={nameDraft !== null}
        onOpenChange={(open) => {
          if (!open) setNameDraft(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename loop</DialogTitle>
            <DialogDescription className="sr-only">
              Change this loop's name.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nameDraft ?? ""}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={80}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nameDraft?.trim()) {
                updateLoop.update({ name: nameDraft.trim() })
                setNameDraft(null)
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNameDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={!nameDraft?.trim() || updateLoop.isPending}
              onClick={() => {
                if (!nameDraft?.trim()) return
                updateLoop.update({ name: nameDraft.trim() })
                setNameDraft(null)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
