import { ZapIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { BetterStackLogo } from "@repo/ui/components/logos/betterstack"
import type { ReactNode } from "react"
import {
  Mention,
  ReviewChangesCard,
  Toggle,
  WorkLog,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import {
  PreviewDocument,
  PreviewTurn,
} from "@/app/components/workspace-preview"

// An Act trigger (trigger-effects.tsx) and the code session it started
// (reference/act-sessions-runbook.md). Better Stack has no connector events,
// so its alerts arrive through a channel webhook.
const BRANCH = "lor/checkout-errors-7c2e"

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-foreground/[0.06] px-1 py-0.5 font-mono text-[12px]">
      {children}
    </code>
  )
}

function SettingRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4 text-[11.5px]">
      <span className="text-lor-text-tertiary-dark">{label}</span>
      <span className="min-w-0 truncate text-lor-text-dark">{children}</span>
    </div>
  )
}

export function TriggerCard() {
  return (
    <MockShell innerClassName="bg-lor-surface-dark p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-lor-border-dark bg-lor-bg-dark text-lor-text-dark">
          <BetterStackLogo className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-lor-text-dark">
            Better Stack alerts
          </p>
          <p className="text-[11px] text-lor-text-tertiary-dark">
            Webhook · #health
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-lor-text-secondary-dark">
          <span className="size-1.5 rounded-full bg-lor-success-dark" />
          Active
        </span>
      </div>
      <div className="mt-4 border-t border-lor-border-dark/60 pt-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[12.5px] font-medium text-lor-text-dark">Act</p>
            <p className="text-[11px] text-lor-text-tertiary-dark">
              Lor works on each alert in its own session
            </p>
          </div>
          <Toggle on />
        </div>
        <p className="mt-3 rounded-lg border border-lor-border-dark/70 bg-lor-bg-dark px-3 py-2.5 text-[12px] leading-relaxed text-lor-text-secondary-dark">
          Find the cause. If it&rsquo;s a bug in our code, prepare a fix and ask
          whoever shipped the change to review it.
        </p>
        <div className="mt-2">
          <SettingRow label="Work in">
            <span className="flex rounded-md bg-lor-bg-dark p-0.5 text-[11px]">
              <span className="px-2 py-0.5 text-lor-text-tertiary-dark">
                Chat
              </span>
              <span className="rounded bg-lor-surface-raised-dark px-2 py-0.5 font-medium">
                Code
              </span>
            </span>
          </SettingRow>
          <SettingRow label="Repository">kestrel/app</SettingRow>
          <SettingRow label="Sessions">Each event starts its own</SettingRow>
        </div>
      </div>
    </MockShell>
  )
}

export function AutomationSession() {
  return (
    <MockShell>
      <div className="flex bg-lor-sidebar-dark p-1.5">
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-lor-border-dark/60">
          <PreviewDocument
            title="Checkout errors after the 2.14 deploy"
            channel="health"
            starter="Theo"
            automation
            age="2h ago"
            repo={{ name: "kestrel/app", branch: BRANCH }}
          >
            <p className="flex flex-wrap items-center gap-1.5 pt-5 text-[12.5px] text-lor-text-tertiary-dark">
              <HugeiconsIcon icon={ZapIcon} size={13} strokeWidth={2} />
              <span className="font-medium text-lor-text-secondary-dark">
                Better Stack alerts
              </span>
              started this session
              <span className="text-lor-text-tertiary-dark/70">· 6:52 AM</span>
            </p>
            <PreviewTurn person="Lor" time="7:04 AM">
              <WorkLog label="Worked" detail="11 tool calls" />
              <p className="mt-3">
                Checkout has failed for about 4% of requests since 2.14 went out
                at 6:40. Every failure is a guest checkout:{" "}
                <Code>formatAddress</Code> now reads{" "}
                <Code>customer.address.line1</Code>, and guests have no saved
                address.
              </p>
              <p className="mt-3">
                I reproduced it in my sandbox, added a guard and completed a
                guest checkout in the browser. The fix is on{" "}
                <Code>{BRANCH}</Code>.
              </p>
              <ReviewChangesCard added={4} removed={1} files={1} />
              <p className="mt-3">
                <Mention>@Theo</Mention> you shipped 2.14, can you review it?
              </p>
            </PreviewTurn>
            <PreviewTurn person="Theo" aside>
              Just got in. Reviewing now.
            </PreviewTurn>
          </PreviewDocument>
        </div>
      </div>
    </MockShell>
  )
}
