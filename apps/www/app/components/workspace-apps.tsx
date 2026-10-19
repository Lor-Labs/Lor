"use client"

import { HashtagIcon, PlayIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AttioLogo } from "@repo/ui/components/logos/attio"
import { type ReactNode, useEffect, useState } from "react"
import { LorAvatar, PersonAvatar, ZOE } from "@/app/components/mock-parts"

function ChannelBar({
  channel,
  children,
}: {
  channel: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-12 items-center gap-2 border-b border-lor-border-dark/60 px-4 text-xs text-lor-text-tertiary-dark">
      <HugeiconsIcon icon={HashtagIcon} size={14} />
      <span className="text-lor-text-secondary-dark">{channel}</span>
      <span className="mx-1 opacity-50">/</span>
      {children}
    </div>
  )
}

const RESEARCH_STEPS = [
  {
    label: "Find teams hiring their first sales rep",
    result: "24 companies found",
  },
  {
    label: "Check for existing accounts in Attio",
    result: "16 already in the CRM",
  },
  { label: "Apply our criteria and rank the rest", result: "3 strong matches" },
]
const ACCOUNTS = [
  { name: "Tidemark", detail: "First sales hire · 18 people", initial: "T" },
  { name: "Morrow", detail: "Founder-led sales · 24 people", initial: "M" },
  { name: "Goodfield", detail: "New sales role · 12 people", initial: "G" },
]

export function ChannelWorkflow() {
  const [completed, setCompleted] = useState(RESEARCH_STEPS.length)
  const running = completed < RESEARCH_STEPS.length

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(
      () => setCompleted((step) => Math.min(step + 1, RESEARCH_STEPS.length)),
      1100
    )
    return () => window.clearInterval(timer)
  }, [running])

  return (
    <div className="bg-lor-bg-dark text-left">
      <ChannelBar channel="gtm">
        <HugeiconsIcon icon={PlayIcon} size={13} />
        <span className="text-lor-text-dark">Account research</span>
      </ChannelBar>
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-2 text-[11px] text-lor-text-tertiary-dark">
          <PersonAvatar src={ZOE} size="size-5" />
          Saved by Zoe for everyone in #gtm
        </div>
        <h3 className="mt-4 text-[23px] font-semibold leading-tight tracking-tight text-lor-text-dark">
          Next week&rsquo;s accounts
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-lor-text-secondary-dark">
          Find the next three accounts worth talking to.
        </p>
        <details className="group mt-5 rounded-lg border border-lor-border-dark/70 bg-lor-sidebar-dark/60 text-xs">
          <summary className="cursor-pointer rounded-lg px-3.5 py-3 text-lor-text-secondary-dark focus-visible:outline-2 focus-visible:outline-agent">
            How we pick accounts{" "}
            <span className="ml-1 text-lor-text-tertiary-dark">
              · Zoe&rsquo;s criteria
            </span>
          </summary>
          <div className="space-y-2 border-t border-lor-border-dark/60 px-3.5 py-3 text-lor-text-tertiary-dark">
            <p>Small finance teams hiring their first sales rep.</p>
            <p>Skip agencies and anyone already in Attio.</p>
            <p className="text-lor-text-secondary-dark">
              Keep the best three, with a reason to reach out.
            </p>
          </div>
        </details>
        <div className="mt-5 flex items-center justify-between gap-3 border-b border-lor-border-dark/60 pb-4">
          <div className="flex items-center gap-2">
            <LorAvatar size="size-6" />
            <div>
              <p className="text-xs text-lor-text-dark">Lor in #gtm</p>
              <p className="mt-0.5 text-[10px] text-lor-text-tertiary-dark">
                {running ? "Running for Rafael" : "Last run by Rafael"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCompleted(0)}
            disabled={running}
            className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent disabled:cursor-default disabled:opacity-50"
          >
            <HugeiconsIcon icon={PlayIcon} size={12} />
            {running ? "Running…" : "Run again"}
          </button>
        </div>
        <div className="space-y-4 py-5">
          {RESEARCH_STEPS.map((step, index) => (
            <div key={step.label} className="flex items-start gap-2.5">
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${completed > index ? "bg-lor-success-dark/10 text-lor-success-dark" : completed === index ? "border border-agent/25 border-t-agent motion-safe:animate-spin" : "border border-lor-border-dark"}`}
              >
                {completed > index ? (
                  <HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2} />
                ) : null}
              </span>
              <div className="min-w-0">
                <p
                  className={`text-xs ${completed >= index ? "text-lor-text-secondary-dark" : "text-lor-text-tertiary-dark"}`}
                >
                  {step.label}
                </p>
                <p className="mt-1 text-[10px] text-lor-text-tertiary-dark">
                  {completed > index
                    ? step.result
                    : completed === index
                      ? "Working…"
                      : "Waiting"}
                </p>
              </div>
              {index === 1 ? (
                <AttioLogo className="ml-auto mt-0.5 size-3.5 text-lor-text-tertiary-dark" />
              ) : null}
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-lg border border-lor-border-dark/70">
          <div className="flex items-center justify-between gap-2 bg-lor-sidebar-dark/70 px-3.5 py-2.5 text-[11px]">
            <span className="font-medium text-lor-text-secondary-dark">
              This week&rsquo;s shortlist
            </span>
            <span className="text-lor-text-tertiary-dark">
              {running ? "Updating…" : "Ready for the team"}
            </span>
          </div>
          <div
            className={`divide-y divide-lor-border-dark/50 px-3.5 ${running ? "opacity-30" : ""}`}
            aria-hidden={running || undefined}
          >
            {ACCOUNTS.map((account) => (
              <div
                key={account.name}
                className="flex items-center gap-2.5 py-2.5"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-lor-border-dark/70 text-[11px] text-lor-text-tertiary-dark">
                  {account.initial}
                </span>
                <div>
                  <p className="text-xs text-lor-text-dark">{account.name}</p>
                  <p className="mt-0.5 text-[10px] text-lor-text-tertiary-dark">
                    {account.detail}
                  </p>
                </div>
                <span className="ml-auto text-[10px] text-lor-success-dark">
                  Good fit
                </span>
              </div>
            ))}
          </div>
        </div>
        <p role="status" className="sr-only">
          {running
            ? `Account research running. ${completed} of 3 steps complete.`
            : "Account research complete. Three accounts ready for the team."}
        </p>
      </div>
    </div>
  )
}
