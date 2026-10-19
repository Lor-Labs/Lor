"use client"

import {
  ArrowUp01Icon,
  DashboardSquare01Icon,
  GridViewIcon,
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

const REQUESTS = [
  {
    id: "owners",
    title: "See who owns each account",
    quote: "We both followed up with the same person.",
    company: "Paygrove",
    votes: 6,
    person: RAFAEL,
    status: "Inbox",
  },
  {
    id: "export",
    title: "Export the weekly report",
    quote: "I need to send this to our board.",
    company: "Northline",
    votes: 4,
    person: ZOE,
    status: "Inbox",
  },
  {
    id: "invite",
    title: "Invite the team during setup",
    quote: "I thought I had to set it all up myself.",
    company: "Meridian",
    votes: 12,
    person: ZOE,
    status: "Building",
  },
  {
    id: "digest",
    title: "A quieter daily digest",
    quote: "One email at the end of the day would be perfect.",
    company: "Common Ground",
    votes: 8,
    person: THEO,
    status: "Building",
  },
] as const

export function FeedbackBoard({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const [view, setView] = useState<"Board" | "List">("Board")
  const [votes, setVotes] = useState<string[]>([])
  const Heading = headingLevel === 2 ? "h2" : "h3"

  function vote(id: string) {
    setVotes((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    )
  }

  function requestCard(request: (typeof REQUESTS)[number]) {
    const voted = votes.includes(request.id)
    return (
      <div
        key={request.id}
        className={`min-w-0 rounded-lg border border-lor-border-dark/70 bg-lor-bg-dark p-3.5 ${view === "List" ? "flex items-center gap-3" : ""}`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug text-lor-text-dark">
            {request.title}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-lor-text-secondary-dark">
            &ldquo;{request.quote}&rdquo;
          </p>
          <p className="mt-1.5 text-[10px] text-lor-text-tertiary-dark">
            {request.company} · Customer call
          </p>
        </div>
        <div
          className={`flex items-center gap-2 ${view === "Board" ? "mt-4 justify-between" : "shrink-0"}`}
        >
          <button
            type="button"
            aria-label={`Support ${request.title}`}
            aria-pressed={voted}
            onClick={() => vote(request.id)}
            className={`inline-flex h-8 min-w-10 cursor-pointer items-center justify-center gap-1 rounded-md border px-1.5 text-[11px] tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent ${voted ? "border-agent/35 bg-agent/10 text-agent" : "border-lor-border-dark/70 text-lor-text-secondary-dark hover:bg-foreground/5"}`}
          >
            <HugeiconsIcon icon={ArrowUp01Icon} size={12} />
            {request.votes + (voted ? 1 : 0)}
          </button>
          {view === "Board" ? (
            <PersonAvatar src={request.person} size="size-5" />
          ) : (
            <span className="hidden text-[10px] text-lor-text-tertiary-dark @sm:inline">
              {request.status}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="@container flex min-w-0 flex-1 flex-col bg-lor-bg-dark text-left">
      <ChannelBar channel="product">
        <HugeiconsIcon icon={DashboardSquare01Icon} size={14} />
        <span className="text-lor-text-dark">Feedback board</span>
        <span className="ml-auto rounded border border-lor-border-dark px-1.5 py-0.5 text-[10px]">
          Team app
        </span>
      </ChannelBar>
      <div className="px-4 pt-6 pb-4 @sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Heading className="text-[23px] font-semibold leading-tight tracking-tight text-lor-text-dark">
              Customer feedback
            </Heading>
            <p className="mt-2 text-xs text-lor-text-tertiary-dark">
              Made by Theo. Used by all of #product.
            </p>
          </div>
          <div
            aria-label="Zoe, Rafael and Theo are here"
            className="flex -space-x-1 pt-1"
          >
            {[ZOE, RAFAEL, THEO].map((person) => (
              <PersonAvatar
                key={person}
                src={person}
                size="size-6"
                className="ring-2 ring-lor-bg-dark"
              />
            ))}
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-xs text-lor-text-secondary-dark">
            4 requests{" "}
            <span className="mx-1 text-lor-text-tertiary-dark">·</span> 4
            customers
          </p>
          <div
            role="group"
            aria-label="Feedback view"
            className="flex rounded-md bg-foreground/[0.04] p-0.5"
          >
            {(["Board", "List"] as const).map((label) => (
              <button
                type="button"
                key={label}
                aria-pressed={view === label}
                onClick={() => setView(label)}
                className={`flex h-8 cursor-pointer items-center gap-1.5 rounded px-2 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-agent ${view === label ? "bg-lor-surface-dark text-lor-text-dark shadow-sm" : "text-lor-text-tertiary-dark hover:text-lor-text-dark"}`}
              >
                <HugeiconsIcon
                  icon={label === "Board" ? GridViewIcon : ListViewIcon}
                  size={13}
                />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 border-t border-lor-border-dark/60 bg-lor-sidebar-dark/60 p-3 @sm:p-4">
        {view === "Board" ? (
          <div className="grid gap-4 @min-[380px]:grid-cols-2">
            {(["Inbox", "Building"] as const).map((status) => (
              <div key={status}>
                <p className="mb-3 flex items-center gap-2 px-1 text-xs font-medium text-lor-text-secondary-dark">
                  <span
                    className={`size-1.5 rounded-full ${status === "Building" ? "bg-agent" : "bg-lor-text-tertiary-dark"}`}
                  />
                  {status}
                  <span className="ml-auto text-[10px] text-lor-text-tertiary-dark">
                    2
                  </span>
                </p>
                <div className="space-y-3">
                  {REQUESTS.filter((request) => request.status === status).map(
                    requestCard
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">{REQUESTS.map(requestCard)}</div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-lor-border-dark/60 px-4 py-3 text-[10px] text-lor-text-tertiary-dark">
        <PersonAvatar src={RAFAEL} size="size-4" />
        Rafael added the Paygrove request
        <span className="ml-auto">Just now</span>
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
