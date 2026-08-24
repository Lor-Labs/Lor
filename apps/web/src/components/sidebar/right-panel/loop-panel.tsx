import {
  CheckmarkCircle02Icon,
  PauseIcon,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { useMemo, useState } from "react"
import {
  LoopFrequencyDialog,
  useActivateLoop,
  useLoopLifecycle,
  useUpdateLoopSchedule,
} from "@/components/loops/loop-actions"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import type { LoopSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { type ChannelLoop, useChannelLoops } from "@/hooks/use-channel-loops"
import { LOOP_PAUSED_REASON_LABEL, LOOP_STATUS_META } from "@/lib/loop-ui"

// Loop detail panel (ChatGPT-scheduled-tasks inspired): the card in chat is
// a compact pill; everything else lives here — the full prompt, a structured
// schedule editor on drafts (Repeat / day / time Selects that round-trip the
// cron via parseLoopSchedule), the timezone (pinned at activation), and
// next/last run. Editing name/instructions and active-loop schedules is L3.

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

// The draft schedule editor rows. Every change formats a fresh cron and
// PATCHes it (optimistic — see useUpdateLoopSchedule). Kind switches carry
// the current time over and default the new fields.
function ScheduleEditor({ loop }: { loop: ChannelLoop }) {
  const update = useUpdateLoopSchedule(loop)
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

  const apply = (next: LoopScheduleShape) =>
    update.mutate(formatLoopSchedule(next))

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
  const { data } = useChannelLoops(view.channelId)
  const loop = data?.find((l) => l.id === view.loopId) ?? null

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
  const [confirmComplete, setConfirmComplete] = useState(false)

  const meta = loop ? LOOP_STATUS_META[loop.status] : null
  const scheduleText = loop ? describeLoopSchedule(loop.schedule, null) : ""
  const isDraft = loop?.status === "draft"

  return (
    <div className="flex h-full w-full flex-col">
      <RightPanelHeader
        title={loop?.name ?? "Loop"}
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
        titleAdornment={
          meta ? (
            <Badge variant={meta.badgeVariant} size="sm" className="shrink-0">
              {meta.label}
            </Badge>
          ) : undefined
        }
        actions={
          loop && (loop.status === "active" || loop.status === "paused") ? (
            <>
              {loop.status === "active" ? (
                <HeaderActionButton
                  label="Pause loop"
                  icon={PauseIcon}
                  disabled={lifecycle.isPending}
                  onClick={() => lifecycle.mutate("pause")}
                />
              ) : (
                <HeaderActionButton
                  label="Resume loop"
                  icon={PlayIcon}
                  disabled={lifecycle.isPending}
                  onClick={() => lifecycle.mutate("resume")}
                />
              )}
              <HeaderActionButton
                label="Mark completed"
                icon={CheckmarkCircle02Icon}
                disabled={lifecycle.isPending}
                onClick={() => setConfirmComplete(true)}
              />
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
          <div className="space-y-2">
            <SectionLabel>Prompt</SectionLabel>
            <div className="rounded-xl border bg-card px-4 py-3.5">
              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                {loop.instructions}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <SectionLabel>Schedule</SectionLabel>
            <div className="divide-y divide-border/70 rounded-xl border bg-card">
              {isDraft ? (
                <ScheduleEditor loop={loop} />
              ) : (
                <DetailRow label="Repeat">{scheduleText}</DetailRow>
              )}
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
              <DetailRow label="End repeat">
                {loop.endCondition ?? "Never"}
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
    </div>
  )
}
