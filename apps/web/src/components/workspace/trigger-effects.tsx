import {
  BrainIcon,
  BubbleChatIcon,
  MagicWand01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Switch } from "@repo/ui/components/switch"
import { Textarea } from "@repo/ui/components/textarea"
import type { ReactNode } from "react"

// Shared effect rows for trigger config (BYO webhooks + connector events).
// One trigger can fan out to any combination of the three effects.
export type TriggerEffectsValue = {
  post: boolean
  remember: boolean
  rememberHint: string | null
  // null = Act off; empty string = Act on, Merlin uses judgment
  actInstructions: string | null
}

export type TriggerEffectsPatch = Partial<TriggerEffectsValue>

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
        description="Merlin summarizes the data into memory so it can recall it later"
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
          />
        )}
      </EffectRow>
      <EffectRow
        id={`${idPrefix}-act`}
        icon={MagicWand01Icon}
        title="Act"
        description="Wake Merlin to take action — it can reply, create tasks, and call your tools"
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
              placeholder="e.g. “if this is a refund over $500, summarize it and create a task”"
              className="min-h-16 text-xs"
              rows={3}
              maxLength={4000}
              disabled={disabled}
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next === value.actInstructions) return
                onPatch({ actInstructions: next })
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              Leave blank to let Merlin decide how to handle each payload.
            </p>
          </div>
        )}
      </EffectRow>
    </div>
  )
}
