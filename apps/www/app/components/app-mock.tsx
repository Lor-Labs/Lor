import {
  ClaudeIcon,
  Globe02Icon,
  HashtagIcon,
  Infinity01Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
  Search01Icon,
  SentIcon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AttioLogo } from "@repo/ui/components/logos/attio"
import { NotionLogo } from "@repo/ui/components/logos/notion"
import { SidebarToggleIcon } from "@repo/ui/components/unlumen-ui/sidebar-toggle-icon"
import type { ReactNode } from "react"
import {
  AgentAvatar,
  Citation,
  FileCard,
  Mention,
  PersonAvatar,
  PlanStep,
  RAFAEL,
  type SessionState,
  SessionStateDot,
  ToolStep,
  Turn,
  WorkLog,
  ZOE,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"

// Hero mock: a #gtm loop session driven by a bring-your-own agent (Claude
// Code). It researched leads on its Monday run, Rafael pulled Zoe in, and Zoe
// is steering the drafts. On phones the mock grows to fit, so the teammate
// turns are never clipped.

function ChannelRow({
  name,
  unread = false,
}: {
  name: string
  unread?: boolean
}) {
  return (
    <div
      className={`relative flex items-center gap-2 rounded-md px-2 py-[5px] text-[13px] ${
        unread
          ? "font-medium text-lor-text-dark"
          : "text-lor-text-secondary-dark"
      }`}
    >
      {unread ? (
        <span className="absolute left-0 size-1 rounded-full bg-lor-text-dark" />
      ) : null}
      <HugeiconsIcon
        icon={HashtagIcon}
        size={14}
        strokeWidth={2}
        className="opacity-50"
      />
      {name}
    </div>
  )
}

function SessionRow({
  label,
  state,
  loop = false,
  active = false,
}: {
  label: string
  state?: SessionState
  loop?: boolean
  active?: boolean
}) {
  return (
    <div
      className={`ml-5 flex items-center gap-2 rounded-md px-2 py-[4px] text-[12.5px] ${
        active
          ? "bg-foreground/[0.06] font-medium text-lor-text-dark"
          : state
            ? "text-lor-text-dark"
            : "text-lor-text-tertiary-dark"
      }`}
    >
      {loop ? (
        <HugeiconsIcon
          icon={Infinity01Icon}
          size={13}
          strokeWidth={2}
          className="shrink-0 opacity-60"
        />
      ) : null}
      <span className="flex-1 truncate">{label}</span>
      {state ? <SessionStateDot state={state} /> : null}
    </div>
  )
}

function MockSidebar() {
  return (
    <div className="hidden w-60 shrink-0 flex-col md:flex">
      <div className="flex gap-1.5 px-4 pt-4 pb-3">
        <span className="size-2.5 rounded-full bg-lor-danger-dark/80" />
        <span className="size-2.5 rounded-full bg-warning/80" />
        <span className="size-2.5 rounded-full bg-lor-success-dark/80" />
      </div>
      <div className="flex items-center gap-2 px-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-agent/20 font-semibold text-[11px] text-agent">
          K
        </span>
        <span className="font-semibold text-[13.5px] text-lor-text-dark">
          Kestrel
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          size={13}
          className="text-lor-text-tertiary-dark"
        />
      </div>
      <div className="mt-3 flex gap-1.5 px-3">
        <div className="flex h-7 flex-1 items-center gap-2 rounded-md border border-lor-border-dark bg-lor-bg-dark px-2 text-[12px] text-lor-text-tertiary-dark">
          <HugeiconsIcon icon={Search01Icon} size={13} />
          Search...
          <span className="ml-auto text-[10px]">⌘K</span>
        </div>
        <span className="flex size-7 items-center justify-center rounded-md border border-lor-border-dark text-lor-text-tertiary-dark">
          <HugeiconsIcon icon={PlusSignIcon} size={13} />
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-px px-3">
        <ChannelRow name="general" />
        <ChannelRow name="gtm" />
        <SessionRow label="Weekly lead research" state="running" loop active />
        <SessionRow label="Follow-ups from Tuesday" state="unread" />
        <SessionRow label="Pricing page rewrite" />
        <ChannelRow name="engineering" />
        <SessionRow label="Checkout errors in 2.14" state="needs_you" />
        <ChannelRow name="product" unread />
        <ChannelRow name="customers" />
      </div>
      <div className="mt-auto flex items-center gap-2 px-4 py-3">
        <PersonAvatar src={ZOE} size="size-6" />
        <span className="font-medium text-[12.5px] text-lor-text-dark">
          Zoe
        </span>
      </div>
    </div>
  )
}

function SessionColumn() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 px-3 text-lor-text-tertiary-dark">
        <span className="-ml-1 flex size-7 items-center justify-center">
          <SidebarToggleIcon isOpen className="size-4" strokeWidth={1.5} />
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          <span className="-space-x-1 flex px-1.5">
            <PersonAvatar
              src={RAFAEL}
              className="ring-2 ring-lor-bg-dark"
              size="size-5"
            />
            <PersonAvatar
              src={ZOE}
              className="ring-2 ring-lor-bg-dark"
              size="size-5"
            />
          </span>
          <span className="flex size-7 items-center justify-center">
            <HugeiconsIcon
              icon={MoreHorizontalIcon}
              className="size-4"
              strokeWidth={2}
            />
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 md:mask-b-from-90% md:overflow-hidden">
        <div className="mx-auto max-w-xl px-5 pt-2 md:px-8">
          <p className="font-semibold text-[22px] text-lor-text-dark leading-tight tracking-tight">
            Weekly lead research
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-lor-text-tertiary-dark">
            <HugeiconsIcon icon={HashtagIcon} size={13} />
            gtm
            <span className="opacity-60">·</span>
            <HugeiconsIcon icon={Infinity01Icon} size={13} />
            Every Monday at 9:00 AM
          </p>
          <div className="mt-4 border-lor-border-dark/60 border-t" />

          <Turn avatar={<AgentAvatar />}>
            <WorkLog label="Worked" detail="14 tool calls" open>
              <ToolStep
                icon={<HugeiconsIcon icon={Globe02Icon} size={13} />}
                label="Searched the web for fintech teams hiring a first AE"
              />
              <ToolStep
                icon={<AttioLogo className="size-3 text-lor-text-dark" />}
                label="Checked 12 companies in Attio"
              />
              <ToolStep
                icon={<NotionLogo className="size-3.5" />}
                label="Read Outbound playbook"
              />
            </WorkLog>
            <p className="mt-2.5">
              Found 12 fintech teams hiring their first sales rep. 5 are already
              in Attio, so I skipped them. Drafts for the other 7 follow your
              outbound playbook.
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 marker:text-lor-text-tertiary-dark max-md:hidden">
              <li>
                <span className="font-medium text-lor-text-dark">
                  Ledgerline
                </span>{" "}
                posted a founding AE role
                <Citation>ledgerline.com/careers</Citation>
              </li>
              <li>
                <span className="font-medium text-lor-text-dark">Paygrove</span>{" "}
                closed a seed round last week
                <Citation>paygrove.com/blog</Citation>
              </li>
              <li>
                <span className="font-medium text-lor-text-dark">Tillwise</span>{" "}
                hired a head of sales
                <Citation>tillwise.com/team</Citation>
              </li>
            </ul>
            <FileCard name="outreach-drafts.md" detail="7 drafts" />
          </Turn>

          <Turn avatar={<PersonAvatar src={RAFAEL} />}>
            <Mention>@Zoe</Mention> you met the Paygrove founder. Can you check
            that one?
          </Turn>
          <Turn avatar={<PersonAvatar src={ZOE} />}>
            Mention the summit in the Paygrove email, and keep it under 80
            words.
          </Turn>
          <Turn avatar={<AgentAvatar />}>
            <WorkLog
              label="Working…"
              detail="Editing outreach-drafts.md"
              working
            />
          </Turn>
        </div>
      </div>

      <div className="mx-auto w-full max-w-xl shrink-0 px-5 pt-1 pb-4 md:px-8">
        <div className="flex items-center gap-2 rounded-xl border border-lor-border-dark bg-lor-surface-dark py-2 pr-2 pl-3 text-lor-text-tertiary-dark">
          <HugeiconsIcon icon={PlusSignIcon} size={14} />
          <span className="flex-1 text-[13px] text-lor-text-tertiary-dark/70">
            Reply…
          </span>
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]">
            <HugeiconsIcon icon={ClaudeIcon} size={12} />
            Claude Code
            <HugeiconsIcon icon={UnfoldMoreIcon} size={11} />
          </span>
          <span className="flex size-6 items-center justify-center rounded-md bg-agent/12 text-agent">
            <HugeiconsIcon icon={SentIcon} size={13} />
          </span>
        </div>
      </div>
    </div>
  )
}

function RailTitle({ title, aside }: { title: string; aside: ReactNode }) {
  return (
    <p className="flex items-center justify-between font-medium text-[11.5px] text-lor-text-tertiary-dark">
      {title}
      <span>{aside}</span>
    </p>
  )
}

function DetailsRail() {
  return (
    <div className="hidden w-60 shrink-0 flex-col lg:flex">
      <div className="flex h-[52px] shrink-0 items-center border-lor-border-dark/70 border-b px-4">
        <p className="font-semibold text-[14px] text-lor-text-dark tracking-tight">
          Details
        </p>
        <span className="-mr-1.5 ml-auto flex size-7 items-center justify-center text-lor-text-tertiary-dark">
          <SidebarToggleIcon
            isOpen
            className="size-4 -scale-x-100"
            strokeWidth={1.5}
          />
        </span>
      </div>
      <div className="flex flex-col gap-6 px-4 pt-4">
        <div>
          <RailTitle title="Plan" aside="3/4" />
          <div className="mt-3">
            <PlanStep status="done" label="Find fintech teams hiring sales" />
            <PlanStep status="done" label="Skip companies already in Attio" />
            <PlanStep status="done" label="Draft a first email for each" />
            <PlanStep status="active" label="Apply Zoe's edits" last />
          </div>
        </div>
        <div>
          <RailTitle title="Files" aside="2" />
          <div className="mt-2.5 flex flex-col gap-1.5">
            <FileCard
              name="outreach-drafts.md"
              detail="MD · 4.2 KB"
              className="w-full pr-3"
            />
            <FileCard
              name="leads.csv"
              detail="CSV · 1.8 KB"
              className="w-full pr-3"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function AppMock() {
  return (
    <MockShell>
      <div
        aria-hidden
        className="flex bg-lor-sidebar-dark text-left md:h-[668px]"
      >
        <MockSidebar />
        <div className="m-2 flex min-w-0 flex-1 overflow-hidden rounded-xl border border-lor-border-dark/60 bg-lor-bg-dark md:ml-0 lg:mr-0">
          <SessionColumn />
        </div>
        <DetailsRail />
      </div>
    </MockShell>
  )
}
