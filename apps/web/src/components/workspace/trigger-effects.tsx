import { Reveal } from "@repo/ui/components/collapsible"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Switch } from "@repo/ui/components/switch"
import { Textarea } from "@repo/ui/components/textarea"
import type { ReactNode } from "react"

// The form for what an incoming event does (a connector event's listener, a
// chat's webhook): an optional condition, then two effects, wake the agent
// and post the event in the chat. Code targets and wake limits are no longer
// set here: the agent starts code sessions itself, the inbox batches bursts,
// and the saved caps stay as a quiet backstop (past one, an event waits for
// the agent's next check-in).

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
  // null = the agent is not woken; empty string = woken, it uses judgment
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
  // Whether a posted event pings the people in the chat.
  notify?: boolean
  // A plain-language condition checked before anything else happens
  // (reference/agents-and-chats.md, decision 40).
  filter?: string | null
}

export type TriggerEffectsPatch = Partial<Omit<TriggerEffectsValue, "lastAct">>

type ActSessionMode = "per_event" | "per_subject" | "ongoing"

// A setting with its control on the right: the row shape every setting in
// this form shares.
export function TriggerRow({
  id,
  label,
  hint,
  children,
}: {
  id?: string
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer font-normal text-sm">
          {label}
        </Label>
        {hint && (
          <p className="mt-0.5 text-muted-foreground text-xs leading-snug">
            {hint}
          </p>
        )}
      </div>
      <div className="flex min-w-0 shrink-0 justify-end">{children}</div>
    </div>
  )
}

export function TriggerEffects({
  idPrefix,
  value,
  disabled,
  channelLabel,
  agentName,
  lead,
  onPatch,
}: {
  idPrefix: string
  value: TriggerEffectsValue
  disabled?: boolean
  channelLabel?: string | null
  // The agent that listens. Null: the chat has none, so there is nobody to
  // wake; unset reads as "the agent".
  agentName?: string | null
  // The host's own rows, shown first (which chat a listener reports in).
  lead?: ReactNode
  onPatch: (patch: TriggerEffectsPatch) => void
}) {
  const target = channelLabel ?? "the chat"
  const agent = agentName ?? "the agent"
  const wake = agentName !== null && value.actInstructions !== null
  return (
    <div className="space-y-4">
      {lead}

      {value.filter !== undefined && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-filter`} className="font-normal text-sm">
            Only when
          </Label>
          <Input
            id={`${idPrefix}-filter`}
            key={`filter:${value.filter ?? ""}`}
            defaultValue={value.filter ?? ""}
            placeholder="Always, or say when, like “it mentions billing”"
            maxLength={500}
            disabled={disabled}
            onBlur={(e) => {
              const next = e.target.value.trim() || null
              if (next === (value.filter ?? null)) return
              onPatch({ filter: next })
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
            }}
          />
        </div>
      )}

      {agentName !== null && (
        <div>
          <TriggerRow
            id={`${idPrefix}-act`}
            label={`Wake ${agent}`}
            hint={`${agentName ?? "The agent"} reads it right away and decides what to do.`}
          >
            <Switch
              id={`${idPrefix}-act`}
              checked={wake}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onPatch({ actInstructions: checked ? "" : null })
              }
            />
          </TriggerRow>
          <Reveal open={wake}>
            {wake && (
              <div className="pt-2.5">
                <Textarea
                  key={value.actInstructions}
                  aria-label={`Instructions for ${agent}`}
                  defaultValue={value.actInstructions ?? ""}
                  placeholder={`Tell ${agent} what to do with it (optional)`}
                  className="min-h-16"
                  rows={2}
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
              </div>
            )}
          </Reveal>
        </div>
      )}

      <div>
        <TriggerRow
          id={`${idPrefix}-post`}
          label={`Post it in ${target}`}
          hint="It shows in the chat as a message."
        >
          <Switch
            id={`${idPrefix}-post`}
            checked={value.post}
            disabled={disabled}
            onCheckedChange={(checked) => onPatch({ post: checked })}
          />
        </TriggerRow>
        {value.notify !== undefined && (
          <Reveal open={value.post}>
            {value.post && (
              <div className="pt-2.5">
                <TriggerRow
                  id={`${idPrefix}-notify`}
                  label="Notify people"
                  hint="Off, it shows as unread and pings nobody."
                >
                  <Switch
                    id={`${idPrefix}-notify`}
                    checked={value.notify}
                    disabled={disabled}
                    onCheckedChange={(checked) => onPatch({ notify: checked })}
                  />
                </TriggerRow>
              </div>
            )}
          </Reveal>
        )}
      </div>
    </div>
  )
}
