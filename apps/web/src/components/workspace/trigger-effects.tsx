import {
  ArrowRight01Icon,
  BubbleChatIcon,
  MagicWand01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Reveal } from "@repo/ui/components/collapsible"
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
import { cn } from "@repo/ui/lib/utils"
import { type ReactNode, useState } from "react"
import { SavedCodeTargetPicker } from "@/components/session/code-target-picker"

// Shared effect rows for trigger config (BYO webhooks + connector events).
// One trigger can fan out to either effect or both.

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
  // null = Act off; empty string = Act on, Lor uses judgment
  actInstructions: string | null
  // Where Act runs go and whether they are code sessions
  // (reference/act-sessions-runbook.md).
  actSessionMode: ActSessionMode
  actCode: { repo: string; branch: string } | null
  // Act rate shape: 0 = one run per delivery, otherwise deliveries inside the
  // window coalesce into one run; caps are rolling-window run limits.
  actWindowSeconds: number
  hourlyRunCap: number
  dailyRunCap: number
  lastAct?: TriggerLastAct | null
}

export type TriggerEffectsPatch = Partial<Omit<TriggerEffectsValue, "lastAct">>

type ActSessionMode = "per_event" | "per_subject" | "ongoing"

const SESSION_MODE_HINTS: Record<ActSessionMode, string> = {
  per_event: "Each event starts its own",
  per_subject: "Events about the same item share one",
  ongoing: "Every event continues one",
}

const WORK_IN_OPTIONS = [
  { value: "chat", label: "Chat" },
  { value: "code", label: "Code" },
]

// One Act option: label and a one-line hint on the left, its control on the
// right (the settings-group row shape, inside the Act effect).
function OptionRow({
  id,
  label,
  hint,
  children,
}: {
  id?: string
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        {hint && (
          <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
        )}
      </div>
      <div className="flex min-w-0 shrink-0 justify-end">{children}</div>
    </div>
  )
}

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

function RunCapInput({
  id,
  value,
  max,
  disabled,
  onCommit,
}: {
  id: string
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
    <Input
      id={id}
      key={value}
      defaultValue={value}
      type="number"
      min={1}
      max={max}
      size="sm"
      className="w-20 text-xs"
      disabled={disabled}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        // Escape closes the surrounding dialog without blurring — commit
        // first so a typed cap isn't silently dropped.
        if (e.key !== "Escape") return
        commit(e.currentTarget.value)
      }}
    />
  )
}

// Batch window and run caps, folded behind a one-line summary: most triggers
// never change them.
function ActLimits({
  idPrefix,
  value,
  disabled,
  onPatch,
}: {
  idPrefix: string
  value: TriggerEffectsValue
  disabled?: boolean
  onPatch: (patch: TriggerEffectsPatch) => void
}) {
  const [open, setOpen] = useState(false)
  const batch =
    value.actWindowSeconds > 0
      ? `${formatWindow(value.actWindowSeconds)} batch`
      : "No batching"
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-9 w-full cursor-pointer items-center justify-between gap-4 text-left"
        onClick={() => setOpen((was) => !was)}
      >
        <span>
          <span className="block font-medium text-xs">Limits</span>
          <span className="block text-[11px] text-muted-foreground">
            Extra events wait, never dropped
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
          {batch} · {value.hourlyRunCap}/hour · {value.dailyRunCap}/day
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className={cn(
              "size-3.5 transition-transform motion-reduce:transition-none",
              open && "rotate-90"
            )}
            strokeWidth={2}
          />
        </span>
      </button>
      <Reveal open={open}>
        {open && (
          <div className="space-y-1 pt-1 pl-3">
            <OptionRow
              id={`${idPrefix}-act-window`}
              label="Batch window"
              hint="Bundles what arrives after the first event"
            >
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
                  className="w-36 text-xs"
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
            </OptionRow>
            <OptionRow id={`${idPrefix}-act-hourly-cap`} label="Runs per hour">
              <RunCapInput
                id={`${idPrefix}-act-hourly-cap`}
                value={value.hourlyRunCap}
                max={HOURLY_CAP_MAX}
                disabled={disabled}
                onCommit={(next) => onPatch({ hourlyRunCap: next })}
              />
            </OptionRow>
            <OptionRow id={`${idPrefix}-act-daily-cap`} label="Runs per day">
              <RunCapInput
                id={`${idPrefix}-act-daily-cap`}
                value={value.dailyRunCap}
                max={DAILY_CAP_MAX}
                disabled={disabled}
                onCommit={(next) => onPatch({ dailyRunCap: next })}
              />
            </OptionRow>
          </div>
        )}
      </Reveal>
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

// Session mode, then Chat or Code with the repo and branch. Code sessions
// never use one ongoing session: unrelated fixes would share a branch.
function ActSessionFields({
  idPrefix,
  value,
  disabled,
  subjectLabel,
  codeScope,
  onPatch,
}: {
  idPrefix: string
  value: TriggerEffectsValue
  disabled?: boolean
  subjectLabel: string
  codeScope?: { workspaceSlug: string; channelId: string }
  onPatch: (patch: TriggerEffectsPatch) => void
}) {
  // Code picked but no repo saved yet.
  const [codePicked, setCodePicked] = useState(false)
  const code = codePicked || value.actCode !== null
  const modeItems: { value: ActSessionMode; label: string }[] = [
    { value: "per_event", label: "New session per event" },
    { value: "per_subject", label: subjectLabel },
    { value: "ongoing", label: "One ongoing session" },
  ]
  return (
    <>
      <OptionRow
        id={`${idPrefix}-act-sessions`}
        label="Sessions"
        hint={SESSION_MODE_HINTS[value.actSessionMode]}
      >
        <Select
          items={modeItems}
          value={value.actSessionMode}
          disabled={disabled}
          onValueChange={(next) => {
            if (next === null || next === value.actSessionMode) return
            onPatch({ actSessionMode: next })
          }}
        >
          <SelectTrigger
            id={`${idPrefix}-act-sessions`}
            size="sm"
            className="w-56 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modeItems.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                disabled={code && opt.value === "ongoing"}
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </OptionRow>
      {codeScope && (
        <OptionRow
          id={`${idPrefix}-act-work-in`}
          label="Work in"
          hint={
            code ? "Each session gets its own branch" : "Lor answers in chat"
          }
        >
          <Select
            items={WORK_IN_OPTIONS}
            value={code ? "code" : "chat"}
            disabled={disabled}
            onValueChange={(next) => {
              if (next === "code") setCodePicked(true)
              if (next !== "chat") return
              setCodePicked(false)
              if (value.actCode) onPatch({ actCode: null })
            }}
          >
            <SelectTrigger
              id={`${idPrefix}-act-work-in`}
              size="sm"
              className="w-56 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORK_IN_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </OptionRow>
      )}
      {codeScope && code && (
        <OptionRow label="Repository" hint="People review and ship the work">
          <SavedCodeTargetPicker
            workspaceSlug={codeScope.workspaceSlug}
            channelId={codeScope.channelId}
            value={value.actCode}
            disabled={disabled}
            onChange={(next) =>
              onPatch({
                actCode: next,
                ...(value.actSessionMode === "ongoing"
                  ? { actSessionMode: "per_subject" as const }
                  : {}),
              })
            }
          />
        </OptionRow>
      )}
    </>
  )
}

export function TriggerEffects({
  idPrefix,
  value,
  disabled,
  channelLabel,
  subjectLabel,
  codeScope,
  onPatch,
}: {
  idPrefix: string
  value: TriggerEffectsValue
  disabled?: boolean
  channelLabel?: string | null
  // The per_subject option's name: what makes two events the same thing.
  subjectLabel: string
  // Where code sessions may start; unset hides Code.
  codeScope?: { workspaceSlug: string; channelId: string }
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
        id={`${idPrefix}-act`}
        icon={MagicWand01Icon}
        title="Act"
        description="Events go to a Lor session — it can reply, start plans, and call your tools"
        checked={value.actInstructions !== null}
        disabled={disabled}
        onCheckedChange={(checked) =>
          onPatch({ actInstructions: checked ? "" : null })
        }
      >
        {value.actInstructions !== null && (
          <div className="space-y-1">
            <Textarea
              key={value.actInstructions}
              defaultValue={value.actInstructions}
              placeholder="Instructions for Lor (optional), e.g. “if this is a refund over $500, summarize it and start a plan”"
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
            <div className="pt-1">
              <ActSessionFields
                idPrefix={idPrefix}
                value={value}
                disabled={disabled}
                subjectLabel={subjectLabel}
                codeScope={codeScope}
                onPatch={onPatch}
              />
              <ActLimits
                idPrefix={idPrefix}
                value={value}
                disabled={disabled}
                onPatch={onPatch}
              />
            </div>
            {value.lastAct && <LastActNote lastAct={value.lastAct} />}
          </div>
        )}
      </EffectRow>
    </div>
  )
}
