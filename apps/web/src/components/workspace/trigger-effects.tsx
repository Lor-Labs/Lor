import {
  BrainIcon,
  BubbleChatIcon,
  MagicWand01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Switch } from "@repo/ui/components/switch"
import { Textarea } from "@repo/ui/components/textarea"
import type { ReactNode } from "react"

// Shared effect rows for trigger config (BYO webhooks + connector events).
// One trigger can fan out to any combination of the three effects.

// The handoff note from the newest Act run on this trigger — what Lor
// concluded last time, shown so the next run's starting point is visible.
// Read-only: never part of a patch.
export type TriggerLastAct = {
  note: string | null
  state: string
  stopReason: string | null
  at: string
}

export type TriggerEffectsValue = {
  post: boolean
  remember: boolean
  rememberHint: string | null
  // null = Act off; empty string = Act on, Lor uses judgment
  actInstructions: string | null
  // Act rate shape: 0 = one run per delivery, otherwise deliveries inside the
  // window coalesce into one run; caps are rolling-window run limits.
  actWindowSeconds: number
  hourlyRunCap: number
  dailyRunCap: number
  lastAct?: TriggerLastAct | null
}

export type TriggerEffectsPatch = Partial<Omit<TriggerEffectsValue, "lastAct">>

const ACT_WINDOW_OPTIONS = [
  { value: 0, label: "Immediate" },
  { value: 60, label: "1 minute" },
  { value: 300, label: "5 minutes" },
  { value: 900, label: "15 minutes" },
  { value: 3600, label: "1 hour" },
]

function formatWindow(seconds: number) {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600
    return hours === 1 ? "1 hour" : `${hours} hours`
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return minutes === 1 ? "1 minute" : `${minutes} minutes`
  }
  return `${seconds} seconds`
}

// Short batch-window label for collapsed trigger summaries (e.g. "batched 5m").
export function formatActWindowShort(seconds: number) {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

function formatRunAt(iso: string) {
  const at = new Date(iso)
  const time = at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
  if (at.toDateString() === new Date().toDateString()) return time
  const date = at.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
  return `${date}, ${time}`
}

// A run that failed or was stopped left no trustworthy handoff, so its outcome
// is stated plainly instead of shown as an empty quote.
function LastActNote({ lastAct }: { lastAct: TriggerLastAct }) {
  const note = lastAct.note?.trim() || null
  const broke = lastAct.state === "failed" || lastAct.state === "stopped"
  let outcome = ""
  if (broke) {
    const reason = lastAct.stopReason ? ` (${lastAct.stopReason})` : ""
    outcome = ` — ${lastAct.state}${reason}${note ? "" : ", no note"}`
  } else if (!note) {
    outcome = " — no note left"
  }
  return (
    <div className="space-y-1 border-border/60 border-t pt-2.5">
      <p className="text-[11px] text-muted-foreground">
        Lor's last run · {formatRunAt(lastAct.at)}
        {outcome}
      </p>
      {note && (
        <p
          title={note}
          className="line-clamp-4 whitespace-pre-wrap border-border border-l pl-2.5 text-muted-foreground text-xs"
        >
          {note}
        </p>
      )}
    </div>
  )
}

// Ceilings mirror the API's own validation (hourly 500 / daily 2000) so a typed
// value can't come back as an opaque 400.
const HOURLY_CAP_MAX = 500
const DAILY_CAP_MAX = 2000

function RunCapField({
  id,
  label,
  value,
  max,
  disabled,
  onCommit,
}: {
  id: string
  label: string
  value: number
  max: number
  disabled?: boolean
  onCommit: (next: number) => void
}) {
  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isInteger(parsed)) return
    const next = Math.min(Math.max(parsed, 1), max)
    if (next === value) return
    onCommit(next)
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        key={value}
        defaultValue={value}
        type="number"
        min={1}
        max={max}
        className="h-8 text-xs"
        disabled={disabled}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          // Escape closes the surrounding dialog without blurring — commit
          // first so a typed cap isn't silently dropped.
          if (e.key !== "Escape") return
          commit(e.currentTarget.value)
        }}
      />
    </div>
  )
}

function EffectRow({
  id,
  icon,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
  children,
}: {
  id: string
  icon: IconSvgElement
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  children?: ReactNode
}) {
  return (
    <div className="p-3">
      <div className="flex items-start gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50">
          <HugeiconsIcon
            icon={icon}
            className="size-3.5 text-muted-foreground"
            strokeWidth={2}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Label htmlFor={id} className="cursor-pointer text-sm">
            {title}
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
      </div>
      {children && <div className="mt-2.5 pl-10">{children}</div>}
    </div>
  )
}

export function TriggerEffects({
  idPrefix,
  value,
  disabled,
  channelLabel,
  onPatch,
}: {
  idPrefix: string
  value: TriggerEffectsValue
  disabled?: boolean
  channelLabel?: string | null
  onPatch: (patch: TriggerEffectsPatch) => void
}) {
  const target = channelLabel ? `#${channelLabel}` : "the channel"
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      <EffectRow
        id={`${idPrefix}-post`}
        icon={BubbleChatIcon}
        title="Post to channel"
        description={`Show the incoming data as a message in ${target}`}
        checked={value.post}
        disabled={disabled}
        onCheckedChange={(checked) => onPatch({ post: checked })}
      />
      <EffectRow
        id={`${idPrefix}-remember`}
        icon={BrainIcon}
        title="Remember"
        description="Lor summarizes the data into memory so it can recall it later"
        checked={value.remember}
        disabled={disabled}
        onCheckedChange={(checked) => onPatch({ remember: checked })}
      >
        {value.remember && (
          <Input
            key={value.rememberHint ?? ""}
            defaultValue={value.rememberHint ?? ""}
            placeholder="Optional hint for how to summarize this data"
            className="h-8 text-xs"
            disabled={disabled}
            onBlur={(e) => {
              const next = e.target.value.trim()
              if (next === (value.rememberHint ?? "")) return
              onPatch({ rememberHint: next || null })
            }}
            onKeyDown={(e) => {
              // Escape closes the surrounding dialog without blurring — commit
              // first so typed text isn't silently dropped.
              if (e.key !== "Escape") return
              const next = e.currentTarget.value.trim()
              if (next === (value.rememberHint ?? "")) return
              onPatch({ rememberHint: next || null })
            }}
          />
        )}
      </EffectRow>
      <EffectRow
        id={`${idPrefix}-act`}
        icon={MagicWand01Icon}
        title="Act"
        description="Each event starts a Lor session — it can reply, start plans, and call your tools"
        checked={value.actInstructions !== null}
        disabled={disabled}
        onCheckedChange={(checked) =>
          onPatch({ actInstructions: checked ? "" : null })
        }
      >
        {value.actInstructions !== null && (
          <div className="space-y-1.5">
            <Textarea
              key={value.actInstructions}
              defaultValue={value.actInstructions}
              placeholder="e.g. “if this is a refund over $500, summarize it and start a plan”"
              className="min-h-16 text-xs"
              rows={3}
              maxLength={4000}
              disabled={disabled}
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next === value.actInstructions) return
                onPatch({ actInstructions: next })
              }}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return
                const next = e.currentTarget.value.trim()
                if (next === value.actInstructions) return
                onPatch({ actInstructions: next })
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              Leave blank to let Lor decide how to handle each payload.
            </p>
            <div className="space-y-2 border-border/60 border-t pt-2.5">
              <div className="space-y-1">
                <Label htmlFor={`${idPrefix}-act-window`} className="text-xs">
                  Batch window
                </Label>
                <Select
                  items={ACT_WINDOW_OPTIONS}
                  value={value.actWindowSeconds}
                  disabled={disabled}
                  onValueChange={(next) => {
                    if (next === null || next === value.actWindowSeconds) return
                    onPatch({ actWindowSeconds: next })
                  }}
                >
                  <SelectTrigger
                    id={`${idPrefix}-act-window`}
                    size="sm"
                    className="w-40 text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACT_WINDOW_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {value.actWindowSeconds > 0
                    ? `The first event wakes Lor right away. Anything else arriving within ${formatWindow(value.actWindowSeconds)} is bundled into one follow-up instead of a run each.`
                    : "Every delivery wakes Lor. Deliveries that arrive while a run is going wait their turn and are handled together as soon as it finishes."}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <RunCapField
                  id={`${idPrefix}-act-hourly-cap`}
                  label="Max runs per hour"
                  value={value.hourlyRunCap}
                  max={HOURLY_CAP_MAX}
                  disabled={disabled}
                  onCommit={(next) => onPatch({ hourlyRunCap: next })}
                />
                <RunCapField
                  id={`${idPrefix}-act-daily-cap`}
                  label="Max runs per day"
                  value={value.dailyRunCap}
                  max={DAILY_CAP_MAX}
                  disabled={disabled}
                  onCommit={(next) => onPatch({ dailyRunCap: next })}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Caps bound how often Lor can run — deliveries beyond them wait
                for the next slot rather than being dropped.
              </p>
            </div>
            {value.lastAct && <LastActNote lastAct={value.lastAct} />}
          </div>
        )}
      </EffectRow>
    </div>
  )
}
