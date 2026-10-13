import {
  ArrowRight01Icon,
  File01Icon,
  Loading03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import { NotionLogo } from "@repo/ui/components/logos/notion"
import Image from "next/image"
import type { ReactNode } from "react"
import { LorMark } from "@/app/components/lor-mark"

// Shared pieces for the product mocks. They copy the web app's session UI
// (apps/web/src/components/session, chat/) at a smaller scale.

// Same DiceBear Lorelei (CC0) people as the web app's onboarding tour
// (apps/web/public/tour).
export const ZOE = "/avatars/zoe.png"
export const RAFAEL = "/avatars/rafael.png"

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

// One turn in a session: gutter avatar, no name row (as in the app).
export function Turn({
  avatar,
  children,
}: {
  avatar: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex gap-3 pt-4">
      {avatar}
      <div className="min-w-0 flex-1 pt-0.5 text-[13.5px] text-lor-text-dark/90 leading-[1.6]">
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

export function FileCard({ name, detail }: { name: string; detail: string }) {
  return (
    <span className="mt-3 flex w-fit items-center gap-2.5 rounded-lg border border-lor-border-dark bg-lor-surface-dark py-2 pr-4 pl-2.5">
      <span className="flex size-7 items-center justify-center rounded-md bg-foreground/[0.06] text-lor-text-secondary-dark">
        <HugeiconsIcon icon={File01Icon} size={15} strokeWidth={1.75} />
      </span>
      <span className="flex flex-col">
        <span className="font-medium text-[12.5px] text-lor-text-dark leading-tight">
          {name}
        </span>
        <span className="text-[11px] text-lor-text-tertiary-dark">
          {detail}
        </span>
      </span>
    </span>
  )
}

export type PlanStepStatus = "done" | "active" | "pending"

export function PlanStep({
  status,
  label,
  last = false,
}: {
  status: PlanStepStatus
  label: string
  last?: boolean
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
          <span className="size-3 rounded-full border-[1.5px] border-primary/20 border-t-primary motion-safe:animate-spin" />
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
