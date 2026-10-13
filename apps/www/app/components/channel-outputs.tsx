import {
  HashtagIcon,
  Infinity01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { DatadogLogo } from "@repo/ui/components/logos/datadog"
import { GitHubLogo } from "@repo/ui/components/logos/github"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import type { ReactNode } from "react"
import {
  Citation,
  LorAvatar,
  ToolStep,
  Turn,
  WorkLog,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { Reveal } from "@/app/components/reveal"

// What Lor produced in two other channels, shown as the output itself.
// Replaces the three equal example cards (example-channels.tsx).

function OutputHeader({
  title,
  channel,
  schedule,
}: {
  title: string
  channel: string
  schedule: string
}) {
  return (
    <>
      <p className="font-semibold text-[17px] text-lor-text-dark leading-tight">
        {title}
      </p>
      <p className="mt-1 flex items-center gap-1 text-[12px] text-lor-text-tertiary-dark">
        <HugeiconsIcon icon={HashtagIcon} size={12} />
        {channel}
        <span className="px-0.5 opacity-60">·</span>
        <HugeiconsIcon icon={Infinity01Icon} size={12} />
        {schedule}
      </p>
    </>
  )
}

const ERRORS = [
  { name: "CheckoutTimeoutError", events: "312", since: "6:41 PM" },
  { name: "StripeWebhookConflict", events: "41", since: "7:02 PM" },
]

function ErrorCheck() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-5 pb-5 text-left md:px-6">
        <OutputHeader
          title="Morning error check"
          channel="engineering"
          schedule="Every weekday at 8:00 AM"
        />
        <Turn avatar={<LorAvatar />}>
          <WorkLog label="Worked" detail="11 tool calls" open>
            <ToolStep
              icon={<DatadogLogo className="size-3.5" />}
              label="Searched error logs since yesterday 8:00 AM"
            />
            <ToolStep
              icon={<GitHubLogo className="size-3" />}
              label="Compared against 6 merged pull requests"
            />
          </WorkLog>
          <p className="mt-2">
            2 new errors overnight. Both started within 20 minutes of #412
            merging.
            <Citation>PR #412</Citation>
          </p>
          <div className="mt-3 overflow-hidden rounded-lg border border-lor-border-dark/70">
            <div className="grid grid-cols-[minmax(0,1fr)_4rem_4.5rem] gap-3 border-lor-border-dark/70 border-b bg-foreground/[0.03] px-3 py-1.5 text-[11px] text-lor-text-tertiary-dark">
              <span>Error</span>
              <span className="text-right">Events</span>
              <span className="text-right">Since</span>
            </div>
            {ERRORS.map((error) => (
              <div
                key={error.name}
                className="grid grid-cols-[minmax(0,1fr)_4rem_4.5rem] gap-3 border-lor-border-dark/50 border-t px-3 py-2 text-[12px] first:border-t-0"
              >
                <span className="truncate font-mono text-lor-text-dark">
                  {error.name}
                </span>
                <span className="text-right font-mono text-lor-text-secondary-dark">
                  {error.events}
                </span>
                <span className="text-right text-lor-text-tertiary-dark tabular-nums">
                  {error.since}
                </span>
              </div>
            ))}
          </div>
        </Turn>
      </div>
    </MockShell>
  )
}

function DigestItem({
  id,
  children,
  shipped = true,
}: {
  id: string
  children: ReactNode
  shipped?: boolean
}) {
  return (
    <li className="flex items-start gap-2 text-[12.5px]">
      {shipped ? (
        <HugeiconsIcon
          icon={Tick02Icon}
          size={14}
          className="mt-0.5 shrink-0 text-lor-success-dark"
        />
      ) : (
        <span className="mt-[5px] size-2 shrink-0 rounded-full border border-warning/70" />
      )}
      <span className="min-w-0">
        <span className="mr-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-lor-text-tertiary-dark">
          <LinearLogo className="size-3" />
          {id}
        </span>
        <span className="text-lor-text-dark/90">{children}</span>
      </span>
    </li>
  )
}

function WeeklyDigest() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-5 pb-5 text-left md:px-6">
        <OutputHeader
          title="Week of Oct 6"
          channel="product"
          schedule="Every Friday at 4:00 PM"
        />
        <Turn avatar={<LorAvatar />}>
          <p className="font-medium text-[12px] text-lor-text-tertiary-dark">
            Shipped
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            <DigestItem id="PRO-209">CSV export for invoices</DigestItem>
            <DigestItem id="PRO-221">
              Faster search in big workspaces
            </DigestItem>
            <DigestItem id="PRO-216">Usage alerts by email</DigestItem>
          </ul>
          <p className="mt-4 font-medium text-[12px] text-lor-text-tertiary-dark">
            Slipped
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            <DigestItem id="PRO-198" shipped={false}>
              SSO setup flow, waiting on the Okta sandbox
              <Citation>message</Citation>
            </DigestItem>
          </ul>
        </Turn>
      </div>
    </MockShell>
  )
}

export function ChannelOutputs() {
  return (
    <section
      id="examples"
      className="relative mx-auto w-full max-w-6xl px-6 py-24"
    >
      <Reveal>
        <h2 className="font-semibold text-3xl leading-[1.08] tracking-[-0.03em] md:text-[40px]">
          Meanwhile, in other channels.
        </h2>
      </Reveal>
      <div className="mt-12 grid grid-cols-1 items-start gap-6 md:grid-cols-[7fr_5fr]">
        <Reveal delay={120}>
          <ErrorCheck />
        </Reveal>
        <Reveal delay={240} className="md:mt-16">
          <WeeklyDigest />
        </Reveal>
      </div>
    </section>
  )
}
