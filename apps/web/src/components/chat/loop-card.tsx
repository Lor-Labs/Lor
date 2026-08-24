import {
  Clock01Icon,
  RepeatIcon,
  Target02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
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
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { type ChannelLoop, useLoopForCard } from "@/hooks/use-channel-loops"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"
import { LOOP_PAUSED_REASON_LABEL, LOOP_STATUS_META } from "@/lib/loop-ui"
import { toSearchPreviewText } from "@/lib/search-preview"

// The card a loop_card message renders as (ChatGPT-scheduled-tasks inspired):
// name + status chip in the header, schedule/end-condition/next-run rows in a
// recessed well, and on drafts a timezone picker + Create Loop button.
// Drafts may carry a null timezone ("not pinned yet") — the schedule renders
// tz-less and the picker defaults to the viewer's device timezone, which the
// activate call pins server-side.
const SURFACE_CLASS =
  "relative mt-1.5 w-full max-w-xl overflow-hidden rounded-xl border bg-card"

function formatRunTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function LoopCard({ message }: { message: Message }) {
  const loop = useLoopForCard(message.channelId, message.id)

  if (!loop) {
    return (
      <div className={SURFACE_CLASS}>
        <p className="line-clamp-2 px-4 py-3.5 text-muted-foreground text-sm leading-5">
          {toSearchPreviewText(message.content, message.mentions ?? [], {
            dropUnresolvedMentions: true,
          })}
        </p>
      </div>
    )
  }
  return <LoopCardBody loop={loop} />
}

function LoopCardBody({ loop }: { loop: ChannelLoop }) {
  const queryClient = useQueryClient()
  const meta = LOOP_STATUS_META[loop.status]
  const deviceTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  )
  const [selectedTimezone, setSelectedTimezone] = useState<string | null>(null)
  const timezone = selectedTimezone ?? loop.timezone ?? deviceTimezone
  const timezones = useMemo(() => {
    const supported =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : [deviceTimezone]
    return supported.includes(timezone) ? supported : [timezone, ...supported]
  }, [deviceTimezone, timezone])
  const timezoneItems = useMemo(
    () => timezones.map((tz) => ({ label: tz.replace(/_/g, " "), value: tz })),
    [timezones]
  )
  // Fires-per-day from a 422 requires_confirmation response; non-null opens
  // the confirm dialog.
  const [confirmFires, setConfirmFires] = useState<number | null>(null)

  const activate = useMutation({
    mutationFn: async (opts: { confirm?: boolean }) => {
      const res = await apiClient.v1.loops[":loopId"].activate.$post({
        param: { loopId: loop.id },
        json: {
          timezone,
          ...(opts.confirm ? { confirmHighFrequency: true } : {}),
        },
      })
      if (res.status === 422) {
        const body = await res.json()
        return {
          kind: "needs_confirmation" as const,
          firesPerDay: body.firesPerDay,
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? "Failed to create the loop")
      }
      const body = await res.json()
      return { kind: "activated" as const, loop: body.loop }
    },
    onSuccess: (result) => {
      if (result.kind === "needs_confirmation") {
        setConfirmFires(result.firesPerDay)
        return
      }
      // loop:updated also lands via the socket; setting directly makes the
      // flip immediate even on a slow connection.
      queryClient.setQueryData(
        ["channel-loops", loop.channelId],
        (existing: ChannelLoop[] | undefined) => {
          if (!existing) return existing
          const rest = existing.filter((l) => l.id !== result.loop.id)
          return [result.loop, ...rest]
        }
      )
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to create the loop"
      )
    },
  })

  const isDraft = loop.status === "draft"
  const scheduleText = describeLoopSchedule(loop.schedule, loop.timezone)

  return (
    <div className={SURFACE_CLASS}>
      <div className="flex items-start justify-between gap-4 px-4 pt-4">
        <div className="min-w-0 space-y-1">
          <p className="text-pretty font-medium text-sm leading-5">
            {loop.name}
          </p>
          <p className="line-clamp-2 text-pretty text-muted-foreground text-sm leading-5">
            {loop.status === "completed" && loop.completedNote
              ? loop.completedNote
              : loop.instructions}
          </p>
        </div>
        <Badge variant={meta.badgeVariant} size="sm" className="shrink-0">
          <HugeiconsIcon icon={meta.icon} size={12} />
          {meta.label}
        </Badge>
      </div>

      <div className="px-4 py-4">
        <div className="min-w-0 space-y-2 rounded-lg bg-secondary/60 px-4 py-3.5 ring-1 ring-border/40 ring-inset">
          <div className="flex items-center gap-2 text-sm">
            <HugeiconsIcon
              icon={RepeatIcon}
              size={14}
              className="shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 truncate">{scheduleText}</span>
          </div>
          {loop.endCondition && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <HugeiconsIcon
                icon={Target02Icon}
                size={14}
                className="shrink-0"
              />
              <span className="min-w-0 truncate">
                Until {loop.endCondition}
              </span>
            </div>
          )}
          {loop.status === "active" && loop.nextRunAt && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <HugeiconsIcon
                icon={Clock01Icon}
                size={14}
                className="shrink-0"
              />
              <span>Next run {formatRunTime(loop.nextRunAt)}</span>
            </div>
          )}
          {loop.status === "paused" && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <HugeiconsIcon
                icon={Clock01Icon}
                size={14}
                className="shrink-0"
              />
              <span>
                {(loop.pausedReason &&
                  LOOP_PAUSED_REASON_LABEL[loop.pausedReason]) ??
                  "Paused"}
              </span>
            </div>
          )}
        </div>

        {isDraft && (
          <div className="mt-3 flex items-center gap-2">
            <Select
              items={timezoneItems}
              value={timezone}
              onValueChange={(v) => v && setSelectedTimezone(v)}
            >
              <SelectTrigger
                aria-label="Timezone"
                className="min-w-0 flex-1"
                disabled={activate.isPending}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="shrink-0"
              loading={activate.isPending}
              onClick={() => activate.mutate({})}
            >
              Create Loop
            </Button>
          </div>
        )}
      </div>

      <AlertDialog
        open={confirmFires !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmFires(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Frequent schedule</AlertDialogTitle>
            <AlertDialogDescription>
              This loop runs{" "}
              <span className="font-semibold text-foreground">
                {scheduleText}
              </span>{" "}
              — up to {confirmFires} times a day. Each run uses Merlin credits.
              Create it anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              onClick={() => {
                setConfirmFires(null)
                activate.mutate({ confirm: true })
              }}
            >
              Create Loop
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
