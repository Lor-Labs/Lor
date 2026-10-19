import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ChatGptIcon,
  ClaudeIcon,
  DashboardSquare01Icon,
  File01Icon,
  HashtagIcon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
  SentIcon,
  UnfoldMoreIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { SidebarToggleIcon } from "@repo/ui/components/unlumen-ui/sidebar-toggle-icon"
import type { ReactNode } from "react"
import {
  LorAvatar,
  PersonAvatar,
  PlanStep,
  RAFAEL,
  THEO,
  ZOE,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"

// Presentation-only versions of SessionHeading, SessionDocument and the
// session work panel. Keep their layout and tokens aligned with apps/web.
export function PreviewTurn({
  person,
  children,
  aside = false,
}: {
  person: "Zoe" | "Theo" | "Rafael" | "Lor" | "Claude Code" | "Codex"
  children: ReactNode
  aside?: boolean
}) {
  const avatars = { Zoe: ZOE, Theo: THEO, Rafael: RAFAEL }
  return (
    <div className="flex gap-3 pt-5">
      <span className="shrink-0" title={person}>
        {person === "Lor" ? (
          <LorAvatar />
        ) : person === "Claude Code" || person === "Codex" ? (
          <span
            className={`flex size-7 items-center justify-center rounded-lg ${person === "Claude Code" ? "bg-[#d9a184]/10 text-[#d9a184]" : "bg-foreground/[0.06] text-lor-text-dark"}`}
          >
            <HugeiconsIcon
              icon={person === "Claude Code" ? ClaudeIcon : ChatGptIcon}
              size={18}
            />
          </span>
        ) : (
          <PersonAvatar src={avatars[person]} />
        )}
      </span>
      <div
        className={`min-w-0 flex-1 pt-0.5 text-[13.5px] leading-[1.65] ${aside ? "text-lor-text-secondary-dark" : "text-lor-text-dark/90"}`}
      >
        <span className="sr-only">{person}: </span>
        {children}
      </div>
    </div>
  )
}

export function PreviewDocument({
  title,
  channel,
  children,
  starter = "Zoe",
  agent = "Lor",
  headingLevel = 3,
  className = "",
}: {
  title: string
  channel: string
  children: ReactNode
  starter?: "Zoe" | "Theo" | "Rafael"
  agent?: "Lor" | "Claude Code" | "Codex"
  headingLevel?: 2 | 3
  className?: string
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3"
  return (
    <div className={`flex min-w-0 flex-1 flex-col bg-lor-bg-dark ${className}`}>
      <div
        aria-hidden="true"
        className="flex h-11 shrink-0 items-center gap-1 px-3 text-lor-text-tertiary-dark"
      >
        <SidebarToggleIcon isOpen className="mr-2 size-4" strokeWidth={1.5} />
        <HugeiconsIcon icon={ArrowLeft01Icon} size={15} />
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={15}
          className="opacity-40"
        />
        <span className="ml-auto flex -space-x-1 px-2">
          {[ZOE, THEO, RAFAEL].map((src) => (
            <PersonAvatar
              key={src}
              src={src}
              size="size-5"
              className="ring-2 ring-lor-bg-dark"
            />
          ))}
        </span>
        <HugeiconsIcon icon={MoreHorizontalIcon} size={17} />
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 px-5 pt-5 pb-6 sm:px-7">
        <Heading className="text-[23px] font-semibold leading-tight tracking-tight text-lor-text-dark">
          {title}
        </Heading>
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-lor-text-tertiary-dark">
          <HugeiconsIcon icon={HashtagIcon} size={13} />
          {channel}
          <span>·</span>Started by {starter}
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            {agent !== "Lor" ? (
              <HugeiconsIcon
                icon={agent === "Claude Code" ? ClaudeIcon : ChatGptIcon}
                size={12}
              />
            ) : null}
            {agent}
          </span>
        </p>
        <div className="mt-5 border-t border-lor-border-dark/50" />
        {children}
        <div
          aria-hidden="true"
          className="mt-7 flex items-center gap-3 text-[13.5px] text-lor-text-tertiary-dark/70"
        >
          <PersonAvatar
            src={
              starter === "Theo" ? THEO : starter === "Rafael" ? RAFAEL : ZOE
            }
          />
          Reply…
        </div>
      </div>
      <div
        aria-hidden="true"
        className="mx-auto flex w-full max-w-3xl items-center gap-3 px-5 py-3 text-lor-text-tertiary-dark sm:px-7"
      >
        <HugeiconsIcon icon={PlusSignIcon} size={16} />
        <span className="text-[11px]">To {agent}</span>
        <HugeiconsIcon icon={UnfoldMoreIcon} size={11} />
        <span className="ml-auto text-[11px]">
          {agent === "Lor" ? "Ask Lor" : agent}
        </span>
        <span className="flex size-7 items-center justify-center rounded-md bg-agent/10 text-agent">
          <HugeiconsIcon icon={SentIcon} size={14} />
        </span>
      </div>
    </div>
  )
}

export function PreviewSidebar({ active }: { active: string }) {
  return (
    <aside
      aria-label="Example workspace"
      className="hidden w-52 shrink-0 flex-col px-3 pb-4 md:flex"
    >
      <div aria-hidden="true" className="flex gap-1.5 px-1 py-4">
        <span className="size-2.5 rounded-full bg-lor-danger-dark/80" />
        <span className="size-2.5 rounded-full bg-warning/80" />
        <span className="size-2.5 rounded-full bg-lor-success-dark/80" />
      </div>
      <div className="flex items-center gap-2 px-1.5 pt-1">
        <span className="flex size-6 items-center justify-center rounded-md bg-agent/20 text-xs font-semibold text-agent">
          K
        </span>
        <span className="text-[14px] font-semibold text-lor-text-dark">
          Kestrel
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          size={13}
          className="text-lor-text-tertiary-dark"
        />
      </div>
      <div
        aria-hidden="true"
        className="mt-4 flex h-8 items-center gap-2 rounded-md border border-lor-border-dark bg-lor-bg-dark px-2 text-[12px] text-lor-text-tertiary-dark"
      >
        <HugeiconsIcon icon={Search01Icon} size={13} />
        Search all channels
      </div>
      <p
        aria-hidden="true"
        className="mt-3 mb-4 flex items-center gap-2 px-2 text-[13px] text-lor-text-secondary-dark"
      >
        <HugeiconsIcon icon={PencilEdit02Icon} size={15} />
        New session
      </p>
      {[
        { name: "general", sessions: [] },
        { name: "product", sessions: ["Customer feedback"] },
        { name: "engineering", sessions: ["Build a feedback board"] },
        { name: "gtm", sessions: ["Research next week's accounts"] },
      ].map((channel) => (
        <div key={channel.name} className="mb-2">
          <p
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${active === channel.name ? "bg-foreground/[0.06] font-medium text-lor-text-dark" : "text-lor-text-secondary-dark"}`}
          >
            <HugeiconsIcon
              icon={HashtagIcon}
              size={14}
              className="opacity-60"
            />
            {channel.name}
          </p>
          {channel.sessions.map((name) => (
            <p
              key={name}
              className={`ml-5 truncate rounded-md px-2 py-1.5 text-xs ${active === name ? "bg-foreground/[0.06] font-medium text-lor-text-dark" : "text-lor-text-tertiary-dark"}`}
            >
              {name}
            </p>
          ))}
          {channel.name === "product" ? (
            <p
              className={`ml-5 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${active === "Feedback board" ? "bg-foreground/[0.06] font-medium text-lor-text-dark" : "text-lor-text-tertiary-dark"}`}
            >
              <HugeiconsIcon icon={DashboardSquare01Icon} size={13} />
              Feedback board
            </p>
          ) : null}
        </div>
      ))}
      <div className="mt-2 mb-4">
        <p className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-lor-text-secondary-dark">
          <HugeiconsIcon
            icon={VolumeHighIcon}
            size={14}
            className="opacity-60"
          />
          team-room
        </p>
        {[
          { name: "Theo", avatar: THEO },
          { name: "Rafael", avatar: RAFAEL },
        ].map((person) => (
          <p
            key={person.name}
            className="ml-6 flex items-center gap-2 px-2 py-1 text-xs text-lor-text-tertiary-dark"
          >
            <PersonAvatar src={person.avatar} size="size-4" />
            {person.name}
          </p>
        ))}
      </div>
      <div className="mt-auto flex items-center gap-2 px-2 pt-5 text-xs text-lor-text-secondary-dark">
        <PersonAvatar src={ZOE} size="size-6" />
        Zoe
      </div>
    </aside>
  )
}

export function PreviewDetails({
  plan,
  files,
  context,
}: {
  plan: string[]
  files: string[]
  context: string
}) {
  return (
    <aside
      aria-label="Session details"
      className="hidden w-52 shrink-0 flex-col xl:flex"
    >
      <div className="flex h-[52px] items-center border-b border-lor-border-dark/70 px-4">
        <p className="text-sm font-semibold text-lor-text-dark">Details</p>
        <SidebarToggleIcon
          isOpen
          className="ml-auto size-4 -scale-x-100 text-lor-text-tertiary-dark"
          strokeWidth={1.5}
        />
      </div>
      <div className="space-y-6 p-4">
        <div>
          <p className="mb-2 text-xs font-medium text-lor-text-tertiary-dark">
            Context
          </p>
          <p className="flex items-center gap-1.5 text-xs text-lor-text-secondary-dark">
            <HugeiconsIcon icon={HashtagIcon} size={13} />
            {context}
          </p>
        </div>
        <div>
          <p className="mb-3 text-xs font-medium text-lor-text-tertiary-dark">
            Plan
          </p>
          {plan.map((label, i) => (
            <PlanStep
              key={label}
              label={label}
              status="done"
              last={i === plan.length - 1}
            />
          ))}
        </div>
        <div>
          <p className="mb-3 text-xs font-medium text-lor-text-tertiary-dark">
            Files
          </p>
          <div className="space-y-3">
            {files.map((file) => (
              <p
                key={file}
                className="flex items-center gap-2 text-xs text-lor-text-secondary-dark"
              >
                <HugeiconsIcon
                  icon={File01Icon}
                  size={14}
                  className="shrink-0"
                />
                <span className="truncate">{file}</span>
              </p>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}

export function PreviewFrame({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <MockShell className={className}>
      <div className="overflow-hidden bg-lor-sidebar-dark p-1.5">
        <div className="overflow-hidden rounded-lg border border-lor-border-dark/60">
          {children}
        </div>
      </div>
    </MockShell>
  )
}
