import {
  AlertCircleIcon,
  ArrowDown01Icon,
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
  daysToDow,
  describeLoopSchedule,
  dowToDays,
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
  DialogPanel,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
  selectTriggerIconClassName,
  selectTriggerVariants,
} from "@repo/ui/components/select"
import { cn } from "@repo/ui/lib/utils"
import { ChevronsUpDownIcon } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { ArtifactFileCard } from "@/components/chat/artifact-file-card"
import { MessageMarkdown } from "@/components/chat/message-markdown"
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

const DOW_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// Trigger summary for the multi-day picker: presets collapse to a word,
// otherwise short names ("Mon, Thu & Sat").
function dowSummary(dow: string): string {
  const days = dowToDays(dow)
  if (days.length === 7) return "Every day"
  if (daysToDow(days) === "1-5") return "Weekdays"
  if (days.join(",") === "0,6") return "Weekends"
  if (days.length === 1) return DOW_LABELS[days[0] ?? 0] ?? ""
  const short = days.map((d) => DOW_SHORT[d])
  return `${short.slice(0, -1).join(", ")} & ${short[short.length - 1]}`
}

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

// Completed is the expected outcome, so it wears no indicator at all — only
// exceptional states (running, failed, stopped, queued) get a quiet word.
const RUN_STATE_META: Record<
  LoopRun["state"],
  {
    label: string
    tone: string
    icon: typeof Clock01Icon
    spin?: boolean
  } | null
> = {
  queued: { label: "Queued", tone: "text-muted-foreground", icon: Clock01Icon },
  working: {
    label: "Running",
    tone: "text-info-foreground",
    icon: Loading03Icon,
    spin: true,
  },
  finalizing: {
    label: "Running",
    tone: "text-info-foreground",
    icon: Loading03Icon,
    spin: true,
  },
  complete: null,
  failed: {
    label: "Failed",
    tone: "text-destructive-foreground",
    icon: AlertCircleIcon,
  },
  stopped: {
    label: "Stopped",
    tone: "text-muted-foreground",
    icon: Cancel01Icon,
  },
}

// One run in the history: collapsed = time + a one-line note preview;
// expanded = the full closing note (rendered as markdown), recorded actions,
// stop reason, and whatever the run spawned (task rows open their thread;
// artifact chips). Expansion animates via the grid-rows 0fr→1fr trick — the
// preview folds away as the detail unfolds, so the note reads as growing
// in place.
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
        aria-expanded={expanded}
        onClick={() => hasDetail && setExpanded((v) => !v)}
        className={cnRunRow(hasDetail)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-sm leading-5">
              {formatRunTime(run.scheduledFor ?? run.createdAt)}
            </p>
            {meta && (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 font-medium text-xs",
                  meta.tone
                )}
              >
                <HugeiconsIcon
                  icon={meta.icon}
                  size={12}
                  className={meta.spin ? "animate-spin" : undefined}
                />
                {meta.label}
              </span>
            )}
          </div>
          {run.note && (
            <div
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                expanded
                  ? "grid-rows-[0fr] opacity-0"
                  : "grid-rows-[1fr] opacity-100"
              )}
            >
              <p className="min-h-0 truncate text-muted-foreground text-xs leading-4">
                {stripMarkdownInline(run.note)}
              </p>
            </div>
          )}
        </div>
        {hasDetail && (
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={16}
            className={cn(
              "shrink-0 text-muted-foreground/50 transition-transform duration-300 ease-out",
              expanded && "rotate-180"
            )}
          />
        )}
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              "space-y-3 px-4 pb-4 transition-opacity duration-200 ease-out",
              expanded ? "opacity-100 delay-75" : "opacity-0"
            )}
          >
            {run.stopReason && run.stopReason !== "completed" && (
              <p className="text-muted-foreground text-xs">
                Stopped: {run.stopReason.replace(/_/g, " ")}
              </p>
            )}
            {run.note && (
              <MessageMarkdown
                content={run.note}
                mentions={[]}
                className="text-muted-foreground text-sm leading-6"
              />
            )}
            {run.effects.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {run.effects.map((effect) => (
                  <span
                    key={effect}
                    className="rounded-md bg-secondary/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border/40 ring-inset"
                  >
                    {effect.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
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
                        if (task.cardMessageId)
                          openTaskThread(task.cardMessageId)
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
        </div>
      </div>
    </div>
  )
}

// Flattens markdown to plain text for the one-line collapsed preview.
function stripMarkdownInline(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim()
}

function cnRunRow(clickable: boolean) {
  return `flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${
    clickable
      ? "cursor-pointer transition-colors hover:bg-foreground/[0.03]"
      : "cursor-default"
  }`
}

const END_MODE_OPTIONS = [
  { label: "Never", value: "never" },
  { label: "On a date", value: "date" },
]
const END_CONDITION_OPTION = { label: "Condition", value: "condition" }
// Default when switching to a date end without picking one yet.
const DEFAULT_END_DAYS = 7

function formatEndDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

// Local YYYY-MM-DD for the native date input.
function toDateInputValue(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

// A picked calendar day ends the loop at that day's local END: "ends Sep 1"
// should include Sep 1's fires.
function endOfDayIso(dateValue: string): string {
  return new Date(`${dateValue}T23:59:59`).toISOString()
}

// End repeat control: Never / On a date (native date input row) / Condition
// (Merlin-authored text, shown read-only — switching away clears it, and it
// can only come back via a new proposal). Modes are mutually exclusive;
// completed loops render static text.
function EndRepeatRows({
  loop,
  onUpdate,
}: {
  loop: ChannelLoop
  onUpdate: (input: {
    endAt?: string | null
    endCondition?: string | null
  }) => void
}) {
  const mode = loop.endCondition ? "condition" : loop.endAt ? "date" : "never"

  if (loop.status === "completed") {
    return (
      <DetailRow label="End repeat">
        {mode === "condition" ? (
          <span className="truncate" title={loop.endCondition ?? ""}>
            {loop.endCondition}
          </span>
        ) : mode === "date" && loop.endAt ? (
          formatEndDate(loop.endAt)
        ) : (
          "Never"
        )}
      </DetailRow>
    )
  }

  const options =
    mode === "condition"
      ? [END_CONDITION_OPTION, ...END_MODE_OPTIONS]
      : END_MODE_OPTIONS

  const changeMode = (next: string) => {
    if (next === mode) return
    if (next === "never") onUpdate({ endAt: null, endCondition: null })
    if (next === "date") {
      const date = new Date()
      date.setDate(date.getDate() + DEFAULT_END_DAYS)
      onUpdate({ endAt: endOfDayIso(toDateInputValue(date.toISOString())) })
    }
  }

  return (
    <>
      <DetailRow label="End repeat">
        <Select
          items={options}
          value={mode}
          onValueChange={(v) => v && changeMode(v)}
        >
          <SelectTrigger aria-label="End repeat" className="h-8 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </DetailRow>
      {mode === "date" && loop.endAt && (
        <DetailRow label="End date">
          <input
            type="date"
            aria-label="End date"
            value={toDateInputValue(loop.endAt)}
            min={toDateInputValue(new Date().toISOString())}
            onChange={(e) => {
              if (e.target.value) {
                onUpdate({ endAt: endOfDayIso(e.target.value) })
              }
            }}
            className="h-8 cursor-pointer rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
          />
        </DetailRow>
      )}
      {mode === "condition" && (
        <DetailRow label="Until">
          <span className="truncate" title={loop.endCondition ?? ""}>
            {loop.endCondition}
          </span>
        </DetailRow>
      )}
    </>
  )
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
      <span className="flex min-w-0 items-center justify-end gap-2 text-right text-muted-foreground text-sm">
        {children}
      </span>
    </div>
  )
}

// Compact timezone label for the Time row: "PST"/"PDT" where the zone
// abbreviates cleanly, otherwise the city name ("Kolkata") — Intl only
// offers "GMT+5:30" for those, which reads worse than the place.
function timezoneAbbreviation(timezone: string): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value
    if (name && !name.startsWith("GMT")) return name
  } catch {}
  return timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone
}

// The schedule editor rows (drafts + live loops; completed is read-only).
// Every change formats a fresh cron and hands it to the parent, which owns
// the PATCH (and the tightened-cadence confirm dialog). Kind switches carry
// the current time over and default the new fields.
function ScheduleEditor({
  loop,
  timezone,
  onApply,
}: {
  loop: ChannelLoop
  // Effective tz (pinned, or the viewer's device tz on unpinned drafts) —
  // display only: it's inferred silently from whoever activates the loop.
  timezone: string
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
          <SelectTrigger aria-label="Repeat" className="h-8 w-40">
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
        <DetailRow label="Days">
          {/* Multi-day picker — checkbox menu dressed as a Select so the row
              matches its neighbors. At least one day stays checked. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Days of the week"
              className={cn(selectTriggerVariants(), "h-8 w-40 min-w-0")}
            >
              <span className="flex-1 truncate">{dowSummary(shape.dow)}</span>
              <ChevronsUpDownIcon className={selectTriggerIconClassName} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {DOW_LABELS.map((label, day) => {
                const days = dowToDays(shape.dow)
                const checked = days.includes(day)
                return (
                  <DropdownMenuCheckboxItem
                    key={label}
                    checked={checked}
                    closeOnClick={false}
                    disabled={checked && days.length === 1}
                    onCheckedChange={(next) => {
                      const nextDays = next
                        ? [...days, day]
                        : days.filter((d) => d !== day)
                      apply({ ...shape, dow: daysToDow(nextDays) })
                    }}
                  >
                    {label}
                  </DropdownMenuCheckboxItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </DetailRow>
      )}

      {shape.kind === "monthly" && (
        <DetailRow label="Day of the month">
          <Select
            items={domItems}
            value={String(shape.dom)}
            onValueChange={(v) => v && apply({ ...shape, dom: Number(v) })}
          >
            <SelectTrigger aria-label="Day of the month" className="h-8 w-40">
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
            <SelectTrigger aria-label="At minute" className="h-8 w-40">
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
            {/* No tz in the UI — people read "9:00 AM" as their own time,
                which is exactly what the silent device-tz pinning delivers.
                The hover answers the rare "whose 9 AM?" question. */}
            <SelectTrigger
              aria-label="Time"
              title={`${formatScheduleTime(hour, minute)} ${timezoneAbbreviation(timezone)} (${timezone.replace(/_/g, " ")})`}
              className="h-8 w-40"
            >
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
  // Effective tz: pinned wins; unpinned drafts read in the viewer's zone
  // (activation pins it silently). Never user-configurable.
  const timezone = loop?.timezone ?? deviceTimezone
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

  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title={
          loop ? (
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate">{loop.name}</span>
                {meta && (
                  <Badge
                    variant={meta.badgeVariant}
                    size="sm"
                    className="shrink-0"
                  >
                    {meta.label}
                  </Badge>
                )}
              </div>
              {/* ChatGPT-style header subtitle carries the run cadence — the
                  config rows stay pure configuration. */}
              <div className="truncate font-normal text-muted-foreground text-xs">
                {scheduleText}
                {loop.status === "active" && loop.nextRunAt
                  ? ` · Next run ${formatRunTime(loop.nextRunAt)}`
                  : ""}
              </div>
            </div>
          ) : (
            "Loop"
          )
        }
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        hideCollapse
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
                    variant="destructive"
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
                  timezone={timezone}
                  onApply={(schedule) => updateLoop.update({ schedule })}
                />
              )}
              <EndRepeatRows
                loop={loop}
                onUpdate={(input) => updateLoop.update(input)}
              />
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
                <MessageMarkdown
                  content={loop.completedNote}
                  mentions={[]}
                  className="text-muted-foreground text-sm leading-6"
                />
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
          <DialogPanel>
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
          </DialogPanel>
          <DialogFooter variant="bare">
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
