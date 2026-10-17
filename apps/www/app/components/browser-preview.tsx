import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BrowserIcon,
  Cancel01Icon,
  ClaudeIcon,
  ComputerTerminal01Icon,
  Folder01Icon,
  LockKeyIcon,
  PlusSignIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { MockShell } from "@/app/components/mock-shell"

// Live view of the #gtm computer's browser (reference/planned/agent-browser.md):
// the agent drives, everyone in the session watches, anyone can take over.
// Never show who is watching (no viewer faces).

const ROLES = [
  {
    title: "Founding Account Executive",
    team: "Sales · New York",
    match: true,
  },
  { title: "Senior Backend Engineer", team: "Engineering · Remote" },
  { title: "Product Designer", team: "Design · Remote" },
]

function AgentCursor() {
  return (
    <span className="pointer-events-none absolute top-[70%] right-[22%] flex items-start">
      <svg
        viewBox="0 0 16 16"
        className="size-4 fill-agent stroke-lor-bg drop-shadow-sm"
        strokeWidth={1.25}
        aria-hidden="true"
      >
        <path d="M2 1.5V13L5.4 9.8L7.6 14.5L9.6 13.6L7.4 8.9H12.2Z" />
      </svg>
      <span className="mt-3 -ml-0.5 whitespace-nowrap rounded-full bg-agent px-2 py-0.5 font-medium text-[10.5px] text-agent-foreground">
        Claude Code
      </span>
    </span>
  )
}

function BrowserWindow() {
  return (
    <div className="overflow-hidden rounded-lg bg-lor-bg text-lor-text shadow-[0_24px_50px_-20px_rgba(0,0,0,0.65)] ring-1 ring-black/10">
      <div className="flex items-end gap-1 bg-lor-sidebar px-2 pt-1.5">
        <span className="flex w-44 items-center gap-2 rounded-t-md bg-lor-bg px-2.5 py-1.5 text-[11px] text-lor-text-secondary">
          <span className="size-3 shrink-0 rounded-[3px] bg-lor-success" />
          <span className="flex-1 truncate">Careers · Ledgerline</span>
          <HugeiconsIcon icon={Cancel01Icon} size={10} />
        </span>
        <HugeiconsIcon
          icon={PlusSignIcon}
          size={11}
          className="mb-2 ml-1 text-lor-text-tertiary"
        />
      </div>
      <div className="flex items-center gap-2 border-lor-border border-b px-2.5 py-1.5 text-lor-text-tertiary">
        <HugeiconsIcon icon={ArrowLeft01Icon} size={13} />
        <HugeiconsIcon icon={ArrowRight01Icon} size={13} />
        <HugeiconsIcon icon={RefreshIcon} size={12} />
        <span className="flex flex-1 items-center gap-1.5 rounded-full bg-lor-sidebar px-3 py-1 text-[11px] text-lor-text-secondary">
          <HugeiconsIcon icon={LockKeyIcon} size={10} />
          ledgerline.com/careers
        </span>
      </div>
      <div className="px-5 pt-5 pb-7 md:px-8">
        <p className="flex items-center gap-1.5 font-semibold text-[12.5px]">
          <span className="size-3.5 rounded-[4px] bg-lor-success" />
          Ledgerline
        </p>
        <p className="mt-4 font-semibold text-[20px] tracking-tight">
          Open roles
        </p>
        <div className="mt-3 flex flex-col gap-1">
          {ROLES.map((role) => (
            <div
              key={role.title}
              className={`relative flex items-center justify-between gap-4 rounded-md px-2.5 py-2 text-[12px] ${
                role.match
                  ? "bg-lor-agent-muted ring-1 ring-lor-agent/40"
                  : "ring-1 ring-lor-border"
              }`}
            >
              <span className="truncate font-medium">{role.title}</span>
              <span className="shrink-0 text-lor-text-tertiary max-sm:hidden">
                {role.team}
              </span>
              {role.match ? <AgentCursor /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const DOCK = [
  { name: "browser", icon: BrowserIcon, active: true },
  { name: "terminal", icon: ComputerTerminal01Icon, active: false },
  { name: "files", icon: Folder01Icon, active: false },
]

function Dock() {
  return (
    <div className="mx-auto mt-3 flex w-fit gap-1.5 rounded-xl bg-foreground/10 p-1.5 ring-1 ring-foreground/15 backdrop-blur">
      {DOCK.map((item) => (
        <span
          key={item.name}
          className="relative flex size-7 items-center justify-center rounded-lg bg-lor-bg text-lor-text-secondary"
        >
          <HugeiconsIcon icon={item.icon} size={15} />
          {item.active ? (
            <span className="-bottom-1 absolute size-1 rounded-full bg-lor-bg" />
          ) : null}
        </span>
      ))}
    </div>
  )
}

export function BrowserPreviewMock() {
  return (
    <MockShell>
      <div aria-hidden className="text-left">
        <div className="bg-gradient-to-br from-agent/45 via-agent/20 to-primary/35 px-4 pt-5 pb-3 md:px-8 md:pt-7">
          <BrowserWindow />
          <Dock />
        </div>
        <div className="flex items-center justify-center gap-3 px-5 py-4">
          <span className="flex items-center gap-1.5 text-[13px] text-lor-text-secondary-dark">
            <HugeiconsIcon
              icon={ClaudeIcon}
              size={14}
              className="text-lor-text-dark"
            />
            <span className="font-medium text-lor-text-dark">Claude Code</span>
            has control
          </span>
          <span className="rounded-full bg-lor-text-dark px-3.5 py-1.5 font-medium text-[12.5px] text-lor-bg-dark">
            Take over
          </span>
        </div>
      </div>
    </MockShell>
  )
}
