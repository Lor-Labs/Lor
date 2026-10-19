"use client"

import {
  DashboardSquare01Icon,
  HashtagIcon,
  ListViewIcon,
  PlayIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AttioLogo } from "@repo/ui/components/logos/attio"
import { type ReactNode, useEffect, useState } from "react"
import {
  LorAvatar,
  PersonAvatar,
  RAFAEL,
  THEO,
  ZOE,
} from "@/app/components/mock-parts"

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

const LAUNCH_CHECKS = [
  {
    title: "Landing page",
    detail: "Copy and screenshots",
    owner: "Zoe",
    avatar: ZOE,
  },
  {
    title: "Help docs",
    detail: "Ready for customer questions",
    owner: "Rafael",
    avatar: RAFAEL,
  },
  {
    title: "Announcement",
    detail: "Email and social copy",
    owner: "Zoe",
    avatar: ZOE,
  },
] as const

export function LaunchChecklist({
  headingLevel = 3,
}: {
  headingLevel?: 2 | 3
}) {
  const [qaReady, setQaReady] = useState(false)
  const Heading = headingLevel === 2 ? "h2" : "h3"

  return (
    <div className="@container flex min-w-0 flex-1 flex-col bg-lor-bg-dark text-left">
      <ChannelBar channel="launch">
        <HugeiconsIcon icon={DashboardSquare01Icon} size={14} />
        <span className="text-lor-text-dark">Launch checklist</span>
        <span className="ml-auto shrink-0 rounded border border-lor-border-dark px-1.5 py-0.5 text-[10px]">
          Team app
        </span>
      </ChannelBar>
      <div className="flex-1 px-4 py-6 @sm:px-6 @lg:px-8 @lg:py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] text-lor-text-tertiary-dark">
              Friday · 10:00 AM
            </p>
            <Heading className="text-[26px] font-semibold leading-tight tracking-tight text-lor-text-dark">
              Friday&rsquo;s launch
            </Heading>
            <p className="mt-2 text-xs leading-relaxed text-lor-text-secondary-dark">
              Everyone&rsquo;s part. All in one place.
            </p>
          </div>
          <div
            className="flex -space-x-1.5 pt-1"
            aria-label="Zoe, Rafael and Theo are here"
          >
            {[ZOE, RAFAEL, THEO].map((person) => (
              <PersonAvatar
                key={person}
                src={person}
                size="size-7"
                className="ring-2 ring-lor-bg-dark"
              />
            ))}
          </div>
        </div>
        <div className="mt-7 mb-6">
          <div className="mb-2.5 flex items-baseline justify-between gap-3 text-xs">
            <span className="font-medium text-lor-text-dark">
              <span className="tabular-nums">{qaReady ? 4 : 3} of 4</span> ready
            </span>
            <span
              className={
                qaReady
                  ? "text-lor-success-dark"
                  : "text-lor-text-tertiary-dark"
              }
            >
              {qaReady ? "All clear for launch" : "Waiting on final QA"}
            </span>
          </div>
          <div className="flex gap-1.5" aria-hidden="true">
            {[0, 1, 2, 3].map((step) => (
              <span
                key={step}
                className={`h-1 flex-1 rounded-full ${step < 3 || qaReady ? "bg-lor-success-dark/70" : "bg-foreground/[0.08]"}`}
              />
            ))}
          </div>
        </div>
        <div className="grid gap-5 @min-[680px]:grid-cols-[minmax(0,1fr)_230px]">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] text-lor-text-tertiary-dark">
              <HugeiconsIcon icon={ListViewIcon} size={13} />
              Launch checks
            </div>
            <div className="divide-y divide-lor-border-dark/60">
              {LAUNCH_CHECKS.map((check) => (
                <div key={check.title} className="flex items-center gap-3 py-4">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-lor-success-dark/10 text-lor-success-dark">
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={12}
                      strokeWidth={2}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-lor-text-dark">
                      {check.title}
                    </p>
                    <p className="mt-1 text-[11px] text-lor-text-tertiary-dark">
                      {check.detail}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-lor-text-secondary-dark">
                    <PersonAvatar src={check.avatar} size="size-5" />
                    <span className="hidden @sm:inline">{check.owner}</span>
                  </span>
                </div>
              ))}
              <div className="flex items-start gap-3 pt-4 pb-1">
                <span
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${qaReady ? "bg-lor-success-dark/10 text-lor-success-dark" : "border border-warning/40 text-warning"}`}
                >
                  {qaReady ? (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={12}
                      strokeWidth={2}
                    />
                  ) : (
                    <span className="size-1.5 rounded-full bg-warning" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-medium text-lor-text-dark">
                      Final QA
                    </p>
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-lor-text-secondary-dark">
                      <PersonAvatar src={THEO} size="size-5" />
                      <span className="hidden @sm:inline">Theo</span>
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-lor-text-tertiary-dark">
                    {qaReady
                      ? "Signed off by Theo"
                      : "One last pass before we tell customers"}
                  </p>
                  <button
                    type="button"
                    aria-label={
                      qaReady ? "Reopen final QA" : "Mark final QA ready"
                    }
                    onClick={() => setQaReady((ready) => !ready)}
                    className={`mt-3 inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent active:scale-[0.97] ${qaReady ? "border-lor-border-dark text-lor-text-secondary-dark hover:bg-foreground/5" : "border-foreground/10 bg-foreground/[0.08] text-lor-text-dark hover:bg-foreground/[0.12]"}`}
                  >
                    {qaReady ? "Reopen QA" : "Mark ready"}
                    {!qaReady ? (
                      <HugeiconsIcon icon={Tick02Icon} size={13} />
                    ) : null}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col rounded-lg border border-lor-border-dark/70 bg-lor-sidebar-dark/60 p-4">
            <p className="text-[11px] text-lor-text-tertiary-dark">
              After QA sign-off
            </p>
            <p className="mt-3 text-[15px] font-medium text-lor-text-dark">
              Customer email
            </p>
            <p className="mt-2 text-xs leading-relaxed text-lor-text-secondary-dark">
              Ready in drafts. Rafael sends it once engineering gives the
              go-ahead.
            </p>
            <div className="mt-4 flex items-center gap-2 text-[11px] text-lor-text-secondary-dark">
              <PersonAvatar src={RAFAEL} size="size-5" />
              Rafael
            </div>
            <div
              role="status"
              className="mt-5 border-t border-lor-border-dark/60 pt-4 @min-[680px]:mt-auto"
            >
              <p
                className={`flex items-center gap-2 text-xs font-medium ${qaReady ? "text-lor-success-dark" : "text-warning"}`}
              >
                {qaReady ? (
                  <HugeiconsIcon icon={Tick02Icon} size={14} />
                ) : (
                  <span className="size-1.5 rounded-full bg-warning" />
                )}
                {qaReady ? "Clear to send" : "On hold"}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-lor-text-tertiary-dark">
                {qaReady
                  ? "Theo signed off. You’re good to go, Rafael."
                  : "Waiting for Theo to mark QA ready."}
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-lor-border-dark/60 px-4 py-3 text-[10px] text-lor-text-tertiary-dark @sm:px-6">
        <PersonAvatar src={qaReady ? THEO : ZOE} size="size-4" />
        <span>
          {qaReady
            ? "Theo marked final QA ready"
            : "Zoe marked the announcement ready"}
        </span>
        <span className="ml-auto shrink-0">Just now</span>
      </div>
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
