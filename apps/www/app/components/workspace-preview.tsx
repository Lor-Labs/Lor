import {
  ArrowLeft02Icon,
  ArrowRight02Icon,
  BubbleChatIcon,
  ChatGptIcon,
  ClaudeIcon,
  File01Icon,
  GitBranchIcon,
  GitForkIcon,
  HashtagIcon,
  MessageMultiple01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
  SentIcon,
  SourceCodeIcon,
  UnfoldMoreIcon,
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
import {
  PreviewReplyActions,
  PreviewSessionMenu,
} from "@/app/components/preview-session-actions"

// Presentation-only versions of SessionHeading, SessionDocument and the
// session work panel. Keep their layout and tokens aligned with apps/web.
export function PreviewTurn({
  person,
  children,
  aside = false,
  onFork,
}: {
  person: "Zoe" | "Theo" | "Rafael" | "Lor" | "Claude Code" | "Codex"
  children: ReactNode
  aside?: boolean
  onFork?: () => void
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
        {!aside &&
        (person === "Lor" || person === "Claude Code" || person === "Codex") ? (
          <PreviewReplyActions onFork={onFork} />
        ) : null}
      </div>
    </div>
  )
}

type PreviewSource = { title: string; kind: "fork" | "continue" }

export function PreviewSessionStrip({
  children,
  onContinueInCode,
  panelControl,
}: {
  children?: ReactNode
  onContinueInCode?: () => void
  panelControl?: ReactNode
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 px-3 text-lor-text-tertiary-dark">
      <SidebarToggleIcon
        isOpen
        className="mr-1 size-4 shrink-0"
        strokeWidth={1.5}
      />
      {children}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <span
          aria-label="Zoe, Theo, and Rafael"
          className="hidden -space-x-1 px-2 sm:flex"
        >
          {[ZOE, THEO, RAFAEL].map((src) => (
            <PersonAvatar
              key={src}
              src={src}
              size="size-5"
              className="ring-2 ring-lor-bg-dark"
            />
          ))}
        </span>
        {onContinueInCode ? (
          <PreviewSessionMenu onContinueInCode={onContinueInCode} />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center"
          >
            <HugeiconsIcon
              icon={MoreHorizontalIcon}
              size={16}
              strokeWidth={2}
            />
          </span>
        )}
        {panelControl ?? (
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center"
          >
            <SidebarToggleIcon
              isOpen
              className="size-4 -scale-x-100"
              strokeWidth={1.5}
            />
          </span>
        )}
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
  source,
  repo,
  hideStrip = false,
  onContinueInCode,
}: {
  title: string
  channel: string
  children: ReactNode
  starter?: "Zoe" | "Theo" | "Rafael"
  agent?: "Lor" | "Claude Code" | "Codex"
  headingLevel?: 2 | 3
  className?: string
  source?: PreviewSource
  repo?: { name: string; branch: string }
  hideStrip?: boolean
  onContinueInCode?: () => void
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3"
  const avatar = starter === "Theo" ? THEO : starter === "Rafael" ? RAFAEL : ZOE
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col bg-lor-bg-dark ${className}`}
    >
      {!hideStrip ? (
        <PreviewSessionStrip onContinueInCode={onContinueInCode} />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-6">
          <Heading className="py-0.5 text-[26px] font-semibold leading-tight tracking-tight text-lor-text-dark">
            {title}
          </Heading>
          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-lor-text-tertiary-dark">
            <span className="inline-flex items-center gap-0.5">
              <HugeiconsIcon icon={HashtagIcon} size={14} strokeWidth={2} />
              {channel}
            </span>
            {repo ? (
              <>
                <span>·</span>
                <span className="inline-flex flex-wrap items-center gap-1">
                  <HugeiconsIcon
                    icon={SourceCodeIcon}
                    size={14}
                    strokeWidth={2}
                  />
                  {repo.name}
                  <HugeiconsIcon
                    icon={GitBranchIcon}
                    className="ml-1"
                    size={14}
                    strokeWidth={2}
                  />
                  {repo.branch}
                </span>
              </>
            ) : null}
            {agent !== "Lor" ? (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <HugeiconsIcon
                    icon={agent === "Claude Code" ? ClaudeIcon : ChatGptIcon}
                    size={14}
                  />
                  {agent}
                </span>
              </>
            ) : null}
            <span>·</span>
            <span className="inline-flex items-center gap-1.5">
              <PersonAvatar src={avatar} size="size-4" />
              Started by {starter}
            </span>
            <span>·</span>
            <span>2m ago</span>
          </p>
          {source ? (
            <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[13px] text-lor-text-tertiary-dark">
              <HugeiconsIcon
                icon={source.kind === "fork" ? GitForkIcon : BubbleChatIcon}
                className="size-3.5 shrink-0"
                strokeWidth={2}
              />
              <span className="shrink-0">
                {source.kind === "fork" ? "Forked from" : "Continued from"}
              </span>
              <span className="min-w-0 truncate font-medium">
                {source.title}
              </span>
            </div>
          ) : null}
          <div className="mt-6 border-t border-lor-border-dark/50" />
          {children}
          <div
            aria-hidden="true"
            className="mt-7 flex items-center gap-3 text-[13.5px] text-lor-text-tertiary-dark/70"
          >
            <PersonAvatar src={avatar} />
            Reply…
          </div>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3 text-lor-text-tertiary-dark"
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
        <span className="ml-auto flex gap-2 text-lor-text-tertiary-dark">
          <HugeiconsIcon icon={ArrowLeft02Icon} size={14} />
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            size={14}
            className="opacity-40"
          />
        </span>
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
        {
          name: "product",
          sessions: [
            "Investigate exports",
            "Export fix (fork)",
            "Fix export feedback",
            "The export decision",
          ],
        },
        { name: "engineering", sessions: [] },
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
              className={`ml-5 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${active === name ? "bg-foreground/[0.06] font-medium text-lor-text-dark" : "text-lor-text-tertiary-dark"}`}
            >
              <HugeiconsIcon
                icon={
                  name === "Export fix (fork)" || name === "Fix export feedback"
                    ? SourceCodeIcon
                    : MessageMultiple01Icon
                }
                className="size-3.5 shrink-0 opacity-60"
                strokeWidth={2}
              />
              <span className="truncate">{name}</span>
            </p>
          ))}
        </div>
      ))}
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
  sourceKind,
}: {
  plan: string[]
  files: string[]
  context: string
  sourceKind?: "fork" | "continue"
}) {
  return (
    <aside
      aria-label="Session details"
      className="hidden min-h-0 w-52 shrink-0 flex-col xl:flex"
    >
      <div className="flex h-16 shrink-0 items-center border-b border-lor-border-dark/70 px-4">
        <p className="text-sm font-semibold text-lor-text-dark">Details</p>
        <SidebarToggleIcon
          isOpen
          className="ml-auto size-4 -scale-x-100 text-lor-text-tertiary-dark"
          strokeWidth={1.5}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4">
        <div>
          <p className="mb-2 text-xs font-medium text-lor-text-tertiary-dark">
            Context
          </p>
          <p className="flex items-center gap-1.5 text-xs text-lor-text-secondary-dark">
            <HugeiconsIcon
              icon={
                sourceKind === "fork"
                  ? GitForkIcon
                  : sourceKind === "continue"
                    ? BubbleChatIcon
                    : HashtagIcon
              }
              size={14}
            />
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
