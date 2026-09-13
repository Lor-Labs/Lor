import { LinearLogo } from "@repo/ui/components/logos/linear"
import { NotionLogo } from "@repo/ui/components/logos/notion"
import {
  Bell,
  ChevronDown,
  Hash,
  Headphones,
  Mic,
  Pin,
  Plus,
  Search,
  Send,
  Settings,
  Smile,
  Users,
  Volume2,
} from "lucide-react"
import Image from "next/image"
import type { ReactNode } from "react"
import { MockShell } from "@/app/components/mock-shell"

export const LOR_AVATAR_URL = "https://cdn.lor.chat/avatars/lor-profile.png"

function Avatar({
  initial,
  className = "",
  size = "size-8",
  text = "text-[13px]",
}: {
  initial: string
  className?: string
  size?: string
  text?: string
}) {
  return (
    <span
      className={`flex ${size} shrink-0 select-none items-center justify-center rounded-full font-medium ${text} text-white/90 ${className}`}
    >
      {initial}
    </span>
  )
}

export function LorAvatar({ size = "size-8" }: { size?: string }) {
  return (
    <Image
      src={LOR_AVATAR_URL}
      alt=""
      width={64}
      height={64}
      className={`${size} shrink-0 rounded-lg`}
    />
  )
}

function ChannelRow({
  name,
  active = false,
  unread = false,
  badge,
  icon,
}: {
  name: string
  active?: boolean
  unread?: boolean
  badge?: string
  icon?: ReactNode
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
        active
          ? "bg-lor-pressed-dark font-medium text-lor-text-dark"
          : unread
            ? "font-medium text-lor-text-dark"
            : "text-lor-text-secondary-dark"
      }`}
    >
      {icon ?? <Hash className="size-3.5 opacity-60" strokeWidth={1.75} />}
      <span className="flex-1">{name}</span>
      {badge ? (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-agent px-1 font-semibold text-[9.5px] text-agent-foreground">
          {badge}
        </span>
      ) : null}
    </div>
  )
}

function DmRow({
  avatar,
  name,
  online = false,
}: {
  avatar: ReactNode
  name: string
  online?: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-lor-text-secondary-dark">
      <span className="relative">
        {avatar}
        {online ? (
          <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-lor-success-dark ring-2 ring-lor-sidebar-dark" />
        ) : null}
      </span>
      {name}
    </div>
  )
}

function VoiceMember({ initial, color }: { initial: string; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md py-1 pl-7 text-[12px] text-lor-text-secondary-dark">
      <Avatar
        initial={initial}
        className={color}
        size="size-4"
        text="text-[8px]"
      />
      {initial === "M" ? "mira" : "sam"}
      <Mic className="ml-auto size-3 opacity-50" strokeWidth={1.75} />
    </div>
  )
}

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

function Reaction({
  emoji,
  count,
  reacted = false,
}: {
  emoji: string
  count: number
  reacted?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${
        reacted
          ? "border-agent/40 bg-agent/15 text-lor-text-dark"
          : "border-lor-border-dark bg-lor-surface-dark text-lor-text-secondary-dark"
      }`}
    >
      {emoji}
      <span className="font-medium">{count}</span>
    </span>
  )
}

function Message({
  avatar,
  name,
  nameClassName = "text-lor-text-dark",
  time,
  badge,
  children,
  footer,
}: {
  avatar: ReactNode
  name: string
  nameClassName?: string
  time: string
  badge?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex gap-3 px-5 py-2">
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`font-medium text-[13.5px] ${nameClassName}`}>
            {name}
          </span>
          {badge}
          <span className="text-[11px] text-lor-text-tertiary-dark">
            {time}
          </span>
        </div>
        <div className="mt-0.5 text-[13.5px] text-lor-text-dark/90 leading-relaxed">
          {children}
        </div>
        {footer}
      </div>
    </div>
  )
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-1.5">
      <span className="h-px flex-1 bg-lor-border-dark/70" />
      <span className="font-medium text-[10.5px] text-lor-text-tertiary-dark">
        {label}
      </span>
      <span className="h-px flex-1 bg-lor-border-dark/70" />
    </div>
  )
}

export function AppMock() {
  return (
    <MockShell>
      <div
        aria-hidden
        className="mask-b-from-80% flex h-[440px] text-left md:h-[580px]"
      >
        {/* Sidebar */}
        <div className="hidden w-56 shrink-0 flex-col border-lor-border-dark/60 border-r bg-lor-sidebar-dark md:flex">
          <div className="flex items-center gap-2 px-4 pt-4 pb-3">
            <span className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-lor-danger-dark/80" />
              <span className="size-2.5 rounded-full bg-warning/80" />
              <span className="size-2.5 rounded-full bg-lor-success-dark/80" />
            </span>
          </div>
          <div className="px-3 pb-2">
            <div className="flex items-center justify-between rounded-lg px-2 py-1.5">
              <span className="flex items-center gap-1 font-semibold text-[14px] text-lor-text-dark">
                Acme
                <ChevronDown
                  className="size-3.5 text-lor-text-tertiary-dark"
                  strokeWidth={1.75}
                />
              </span>
              <Bell
                className="size-3.5 text-lor-text-tertiary-dark"
                strokeWidth={1.75}
              />
            </div>
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-lor-border-dark/70 bg-lor-bg-dark px-2.5 py-1.5 text-[12px] text-lor-text-tertiary-dark">
              <Search className="size-3.5" strokeWidth={1.75} />
              Search
              <span className="ml-auto rounded border border-lor-border-dark px-1 font-medium text-[9px]">
                ⌘K
              </span>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-0.5 overflow-hidden px-3 pt-2">
            <p className="px-2 pb-1 font-medium text-[11px] text-lor-text-tertiary-dark">
              Channels
            </p>
            <ChannelRow name="general" unread badge="2" />
            <ChannelRow name="engineering" unread />
            <ChannelRow name="design" />
            <ChannelRow name="launch" active />
            <ChannelRow name="support" />
            <p className="px-2 pt-4 pb-1 font-medium text-[11px] text-lor-text-tertiary-dark">
              Voice
            </p>
            <ChannelRow
              name="Daily sync"
              icon={
                <Volume2 className="size-3.5 opacity-60" strokeWidth={1.75} />
              }
            />
            <VoiceMember initial="M" color="bg-rose-700" />
            <VoiceMember initial="S" color="bg-sky-700" />
            <p className="px-2 pt-4 pb-1 font-medium text-[11px] text-lor-text-tertiary-dark">
              Direct messages
            </p>
            <DmRow avatar={<LorAvatar size="size-5" />} name="Lor" online />
            <DmRow
              avatar={
                <Avatar
                  initial="P"
                  className="bg-amber-700"
                  size="size-5"
                  text="text-[9px]"
                />
              }
              name="priya"
              online
            />
            <DmRow
              avatar={
                <Avatar
                  initial="S"
                  className="bg-sky-700"
                  size="size-5"
                  text="text-[9px]"
                />
              }
              name="sam"
            />
          </div>
          <div className="flex items-center gap-2 border-lor-border-dark/60 border-t px-3 py-2.5">
            <Avatar
              initial="J"
              className="bg-agent/30 text-agent"
              size="size-6"
              text="text-[10px]"
            />
            <span className="font-medium text-[12.5px] text-lor-text-dark">
              jacob
            </span>
            <span className="ml-auto flex items-center gap-2 text-lor-text-tertiary-dark">
              <Mic className="size-3.5" strokeWidth={1.75} />
              <Headphones className="size-3.5" strokeWidth={1.75} />
              <Settings className="size-3.5" strokeWidth={1.75} />
            </span>
          </div>
        </div>

        {/* Channel view */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-lor-border-dark/60 border-b px-5 py-3">
            <Hash
              className="size-4 text-lor-text-tertiary-dark"
              strokeWidth={1.75}
            />
            <span className="font-semibold text-[14px] text-lor-text-dark">
              launch
            </span>
            <span className="hidden truncate text-[12px] text-lor-text-tertiary-dark sm:block">
              Everything for the May release
            </span>
            <span className="ml-auto flex items-center gap-3 text-lor-text-tertiary-dark">
              <Pin className="size-3.5" strokeWidth={1.75} />
              <span className="hidden items-center sm:flex">
                <span className="-space-x-1.5 flex">
                  <Avatar
                    initial="S"
                    className="bg-sky-700 ring-2 ring-lor-bg-dark"
                    size="size-5"
                    text="text-[9px]"
                  />
                  <Avatar
                    initial="M"
                    className="bg-rose-700 ring-2 ring-lor-bg-dark"
                    size="size-5"
                    text="text-[9px]"
                  />
                  <Avatar
                    initial="P"
                    className="bg-amber-700 ring-2 ring-lor-bg-dark"
                    size="size-5"
                    text="text-[9px]"
                  />
                </span>
                <span className="ml-1.5 text-[11px]">12</span>
              </span>
              <Users className="size-3.5" strokeWidth={1.75} />
            </span>
          </div>

          <div className="flex-1 space-y-0.5 overflow-hidden py-3">
            <DateDivider label="Today" />
            <Message
              avatar={<Avatar initial="S" className="bg-sky-700" />}
              name="sam"
              time="10:42 AM"
              footer={
                <div className="mt-1.5 flex gap-1.5">
                  <Reaction emoji="😅" count={3} />
                  <Reaction emoji="🔧" count={1} />
                </div>
              }
            >
              QA found the checkout regression again on staging, pulling the fix
              into this sprint
            </Message>
            <Message
              avatar={<Avatar initial="M" className="bg-rose-700" />}
              name="mira"
              time="10:44 AM"
            >
              wait, are we still good for the original date then?
            </Message>
            <Message
              avatar={<Avatar initial="P" className="bg-amber-700" />}
              name="priya"
              time="10:45 AM"
            >
              <span className="rounded bg-agent/15 px-1 py-0.5 font-medium text-agent">
                @Lor
              </span>{" "}
              when did we decide to move the launch, and why?
            </Message>
            <Message
              avatar={<LorAvatar />}
              name="Lor"
              nameClassName="text-agent"
              time="10:45 AM"
              badge={
                <span className="rounded bg-agent/15 px-1 py-px font-medium text-[9.5px] text-agent uppercase">
                  App
                </span>
              }
              footer={
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <Reaction emoji="✅" count={2} reacted />
                    <Reaction emoji="🙏" count={1} />
                  </div>
                  <span className="flex items-center gap-1.5 font-medium text-[11.5px] text-agent">
                    <span className="-space-x-1 flex">
                      <Avatar
                        initial="M"
                        className="bg-rose-700 ring-1 ring-lor-bg-dark"
                        size="size-3.5"
                        text="text-[7px]"
                      />
                      <Avatar
                        initial="P"
                        className="bg-amber-700 ring-1 ring-lor-bg-dark"
                        size="size-3.5"
                        text="text-[7px]"
                      />
                    </span>
                    2 replies
                    <span className="font-normal text-[11px] text-lor-text-tertiary-dark">
                      Last reply 5m ago
                    </span>
                  </span>
                </div>
              }
            >
              The launch moved from{" "}
              <span className="font-medium text-lor-text-dark">May 21</span> to{" "}
              <span className="font-medium text-lor-text-dark">May 28</span>. QA
              pushed it a week after the checkout regression on staging, and
              Jacob locked the new date in{" "}
              <span className="text-agent">#engineering</span>.
              <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <SourceChip icon={<LinearChipIcon />} label="DESIGN-204" />
                <SourceChip icon={<NotionChipIcon />} label="Q2 launch plan" />
                <SourceChip
                  icon={
                    <Hash className="size-3 opacity-60" strokeWidth={1.75} />
                  }
                  label="engineering · May 12"
                />
              </span>
            </Message>
          </div>

          <div className="px-5 pb-4">
            <p className="flex items-center gap-1.5 pb-1.5 pl-1 text-[11px] text-lor-text-tertiary-dark">
              <span className="flex gap-0.5">
                <span className="size-1 animate-pulse rounded-full bg-lor-text-tertiary-dark" />
                <span className="size-1 animate-pulse rounded-full bg-lor-text-tertiary-dark [animation-delay:150ms]" />
                <span className="size-1 animate-pulse rounded-full bg-lor-text-tertiary-dark [animation-delay:300ms]" />
              </span>
              <span className="font-medium">mira</span> is typing…
            </p>
            <div className="flex items-center gap-3 rounded-xl border border-lor-border-dark bg-lor-surface-dark px-3.5 py-2.5 text-[13px] text-lor-text-tertiary-dark">
              <Plus className="size-4" strokeWidth={1.75} />
              <span className="flex-1">Message #launch</span>
              <Smile className="size-4" strokeWidth={1.75} />
              <span className="flex size-6 items-center justify-center rounded-md bg-agent text-agent-foreground">
                <Send className="size-3" strokeWidth={2} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </MockShell>
  )
}
