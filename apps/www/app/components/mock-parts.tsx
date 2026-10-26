import {
  ArrowRight01Icon,
  ChatGptIcon,
  ClaudeIcon,
  Loading03Icon,
  LockKeyIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { FileTypeIcon } from "@repo/ui/components/file-type-icon"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import { NotionLogo } from "@repo/ui/components/logos/notion"
import Image from "next/image"
import type { ReactNode } from "react"
import { LorMark } from "@/app/components/lor-mark"

// Shared pieces for the product mocks. They copy the web app's session UI
// (apps/web/src/components/session, chat/) at a smaller scale.

// DiceBear Lorelei (CC0), the same style and people as the web app's
// onboarding tour (apps/web/public/tour). Theo was downloaded for www only.
export const ZOE = "/avatars/zoe.png"
export const RAFAEL = "/avatars/rafael.png"
export const THEO = "/avatars/theo.png"

export function PersonAvatar({
  src,
  className = "",
  size = "size-7",
}: {
  src: string
  className?: string
  size?: string
}) {
  return (
    <Image
      src={src}
      alt=""
      width={64}
      height={64}
      className={`${size} shrink-0 select-none rounded-full ${className}`}
    />
  )
}

export function LorAvatar({ size = "size-7" }: { size?: string }) {
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-lg bg-black ring-1 ring-foreground/10`}
    >
      <LorMark className="size-[58%]" />
    </span>
  )
}

export type Agent = "claude" | "codex"

const AGENTS = {
  claude: { name: "Claude Code", icon: ClaudeIcon },
  codex: { name: "Codex", icon: ChatGptIcon },
} as const

// Lor running a bring-your-own agent: the Lor mark, badged with the agent.
export function AgentAvatar({ agent = "claude" }: { agent?: Agent }) {
  return (
    <span className="relative flex h-fit shrink-0">
      <LorAvatar />
      <span className="-right-1 -bottom-1 absolute flex size-4 items-center justify-center rounded-full bg-lor-surface-raised-dark text-lor-text-dark ring-2 ring-lor-bg-dark">
        <HugeiconsIcon
          icon={AGENTS[agent].icon}
          className="size-2.5"
          strokeWidth={2}
        />
      </span>
    </span>
  )
}

// Name row for an agent turn: "Lor · Claude Code".
export function AgentName({ agent = "claude" }: { agent?: Agent }) {
  return (
    <>
      Lor{" "}
      <span className="font-normal text-lor-text-tertiary-dark">
        · {AGENTS[agent].name}
      </span>
    </>
  )
}

export type SessionState = "running" | "unread" | "needs_you"

export function SessionStateDot({ state }: { state: SessionState }) {
  if (state === "running") {
    return (
      <span className="size-3 shrink-0 rounded-full border-[1.5px] border-agent/20 border-t-agent motion-safe:animate-spin" />
    )
  }
  if (state === "unread") {
    return <span className="mx-[3px] size-1.5 shrink-0 rounded-full bg-info" />
  }
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-warning/12 font-semibold text-[10px] text-warning-foreground">
      !
    </span>
  )
}

export function Mention({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-primary/15 px-1 font-medium text-primary">
      {children}
    </span>
  )
}

export function Citation({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1 inline-flex items-center rounded bg-primary/10 px-1 py-0.5 text-[0.82em] text-primary leading-none">
      ↗ {children}
    </span>
  )
}

// One turn in a session: gutter avatar. The app has no name row; `name` adds
// one where a mock has to read at a glance.
export function Turn({
  avatar,
  name,
  children,
}: {
  avatar: ReactNode
  name?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex gap-3 pt-4">
      {avatar}
      <div className="min-w-0 flex-1 pt-0.5 text-[13.5px] text-lor-text-dark/90 leading-[1.6]">
        {name ? (
          <p className="mb-1 font-medium text-[12.5px] text-lor-text-dark leading-tight">
            {name}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  )
}

// Lor's work log row above an answer. `working` swaps the chevron for a
// spinner and shimmers the label.
export function WorkLog({
  label,
  detail,
  working = false,
  open = false,
  children,
}: {
  label: string
  detail?: string
  working?: boolean
  open?: boolean
  children?: ReactNode
}) {
  return (
    <div className="text-[12.5px] text-lor-text-tertiary-dark">
      <div className="flex items-center gap-1.5">
        <HugeiconsIcon
          icon={working ? Loading03Icon : ArrowRight01Icon}
          size={13}
          strokeWidth={2}
          className={
            working ? "motion-safe:animate-spin" : open ? "rotate-90" : ""
          }
        />
        <span className={working ? "shimmer" : ""}>{label}</span>
        {detail ? (
          <span className="text-lor-text-tertiary-dark/70">· {detail}</span>
        ) : null}
      </div>
      {children ? (
        <div className="mt-1.5 ml-[6px] flex flex-col gap-1 border-foreground/10 border-l pl-3.5">
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function ToolStep({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-2 text-[11.5px] text-lor-text-secondary-dark">
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </span>
  )
}

// Copies the app's ArtifactFileCard (FileChip + FileTypeIcon).
export function FileCard({
  name,
  detail,
  className = "mt-3 w-fit pr-4",
}: {
  name: string
  detail: string
  className?: string
}) {
  return (
    <span
      className={`flex min-w-0 items-center gap-2.5 rounded-xl border border-lor-border-dark bg-lor-surface-dark py-2 pl-2.5 ${className}`}
    >
      <FileTypeIcon filename={name} className="size-7" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-[12.5px] text-lor-text-dark leading-tight">
          {name}
        </span>
        <span className="mt-0.5 truncate text-[11px] text-lor-text-tertiary-dark tabular-nums">
          {detail}
        </span>
      </span>
    </span>
  )
}

export function ReviewChangesCard({
  added,
  removed,
  files,
  onClick,
}: {
  added: number
  removed: number
  files: number
  onClick?: () => void
}) {
  const className =
    "mt-3 flex w-64 max-w-full flex-col gap-2 rounded-lg border border-lor-border-dark bg-lor-surface-dark px-3.5 py-3 text-left"
  const content = (
    <>
      <span className="flex items-center justify-between gap-3 font-medium text-[13px] text-lor-text-dark leading-5">
        Review changes
        {onClick ? (
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={14}
            className="shrink-0 text-lor-text-tertiary-dark"
          />
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
        <span className="font-mono tabular-nums text-lor-success-dark">
          +{added}
        </span>
        <span className="font-mono tabular-nums text-lor-danger-dark">
          −{removed}
        </span>
        <span className="ml-1 text-lor-text-tertiary-dark">
          {files} {files === 1 ? "file" : "files"} changed
        </span>
      </span>
    </>
  )

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      data-preview-target="review"
      className={`${className} cursor-pointer touch-manipulation hover:bg-foreground/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent`}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  )
}

// A person's message in channel chat: avatar, name and time, then the body.
export function ChatLine({
  avatar,
  name,
  time,
  children,
}: {
  avatar: string
  name: string
  time: string
  children: ReactNode
}) {
  return (
    <div className="flex gap-2.5 pt-3">
      <PersonAvatar src={avatar} size="size-6" />
      <div className="min-w-0 text-[12.5px] text-lor-text-dark/90">
        <p className="flex items-baseline gap-1.5">
          <span className="font-medium text-lor-text-dark">{name}</span>
          <span className="text-[10.5px] text-lor-text-tertiary-dark">
            {time}
          </span>
        </p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  )
}

export function ApprovalCard({ title, tool }: { title: string; tool: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-lor-border-dark/60 bg-foreground/[0.025] py-2.5 ps-3 pe-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning/12 text-warning-foreground">
        <HugeiconsIcon icon={LockKeyIcon} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[12.5px] text-lor-text-dark leading-5">
          {title}
        </p>
        <p className="text-[11px] text-lor-text-tertiary-dark">
          Needs your approval · <span className="font-mono">{tool}</span>
        </p>
      </div>
      <span className="flex gap-1.5">
        <span className="rounded-md px-2.5 py-1 font-medium text-[12px] text-lor-text-secondary-dark">
          Reject
        </span>
        <span className="rounded-md bg-primary px-2.5 py-1 font-medium text-[12px] text-primary-foreground">
          Approve
        </span>
      </span>
    </div>
  )
}

export function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 ${
        on ? "bg-primary" : "bg-foreground/15"
      }`}
    >
      <span
        className={`size-3 rounded-full bg-white ${on ? "translate-x-3" : ""}`}
      />
    </span>
  )
}

export type PlanStepStatus = "done" | "active" | "pending"

export function PlanStep({
  status,
  label,
  last = false,
  paused = false,
}: {
  status: PlanStepStatus
  label: string
  last?: boolean
  paused?: boolean
}) {
  return (
    <div className="relative flex items-start gap-2.5 pb-2.5">
      {last ? null : (
        <span className="absolute top-5 bottom-0 left-2.5 w-px bg-lor-border-dark" />
      )}
      {status === "done" ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary">
          <HugeiconsIcon
            icon={Tick02Icon}
            size={12}
            strokeWidth={3}
            className="text-primary-foreground"
          />
        </span>
      ) : status === "active" ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-lor-bg-dark shadow-[0_0_0_3px_--theme(--color-primary/8%)]">
          <span
            style={{ animationPlayState: paused ? "paused" : undefined }}
            className="size-3 rounded-full border-[1.5px] border-primary/20 border-t-primary motion-safe:animate-spin"
          />
        </span>
      ) : (
        <span className="size-5 shrink-0 rounded-full border border-lor-border-dark bg-lor-bg-dark" />
      )}
      <span
        className={`pt-px font-medium text-[12px] leading-[18px] ${
          status === "active"
            ? "shimmer text-lor-text-dark"
            : "text-lor-text-tertiary-dark"
        }`}
      >
        {label}
      </span>
    </div>
  )
}

// Old answer chips, still used by feature-chapters until its rewrite.
export function SourceChip({
  icon,
  label,
}: {
  icon: ReactNode
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-lor-border-dark bg-lor-surface-dark px-2 py-1 font-medium text-[11px] text-lor-text-secondary-dark">
      {icon}
      {label}
    </span>
  )
}

export function LinearChipIcon() {
  return <LinearLogo className="size-3" mode="dark" />
}

export function NotionChipIcon() {
  return (
    <span className="flex size-3 items-center justify-center overflow-hidden rounded-[2px] bg-foreground">
      <NotionLogo className="size-3" />
    </span>
  )
}
