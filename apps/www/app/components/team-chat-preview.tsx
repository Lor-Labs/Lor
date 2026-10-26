import {
  HashtagIcon,
  MoreHorizontalIcon,
  Notification01Icon,
  Pin02Icon,
  PlusSignIcon,
  Search01Icon,
  SentIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { SidebarToggleIcon } from "@repo/ui/components/unlumen-ui/sidebar-toggle-icon"
import type { ReactNode } from "react"
import {
  FileCard,
  Mention,
  PersonAvatar,
  RAFAEL,
  THEO,
  ZOE,
} from "@/app/components/mock-parts"

function ChannelMessage({
  person,
  time,
  children,
}: {
  person: "Zoe" | "Theo" | "Rafael"
  time: string
  children: ReactNode
}) {
  const avatars = { Zoe: ZOE, Theo: THEO, Rafael: RAFAEL }
  return (
    <div className="flex gap-3 py-2.5">
      <PersonAvatar src={avatars[person]} size="size-9" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-lor-text-dark">
            {person}
          </span>
          <span className="text-[11px] text-lor-text-tertiary-dark">
            {time}
          </span>
        </p>
        <div className="mt-1 text-[13.5px] leading-[1.65] text-lor-text-dark/90">
          {children}
        </div>
      </div>
    </div>
  )
}

// Mirrors ChatHeader, channel MessageItem, DateDivider and the channel composer.
export function TeamChatPreview() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-lor-bg-dark text-left">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-lor-border-dark/60 px-4 text-lor-text-tertiary-dark">
        <span
          aria-hidden="true"
          className="flex items-center border-r border-lor-border-dark/60 pr-3"
        >
          <SidebarToggleIcon isOpen className="mr-1 size-4" strokeWidth={1.5} />
        </span>
        <HugeiconsIcon icon={HashtagIcon} size={18} />
        <h2 className="text-[15px] font-semibold text-lor-text-dark">
          product
        </h2>
        <span aria-hidden="true" className="ml-auto flex items-center gap-3">
          <HugeiconsIcon icon={Search01Icon} size={16} />
          <HugeiconsIcon icon={Notification01Icon} size={16} />
          <HugeiconsIcon icon={Pin02Icon} size={16} />
          <SidebarToggleIcon
            isOpen
            className="size-4 -scale-x-100"
            strokeWidth={1.5}
          />
          <HugeiconsIcon icon={MoreHorizontalIcon} size={17} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-6 pb-3 sm:px-6">
        <div className="relative my-3 flex items-center">
          <div className="h-px w-full bg-lor-border-dark/60" />
          <span className="absolute left-1/2 -translate-x-1/2 rounded-full border border-lor-border-dark/60 bg-lor-bg-dark px-2.5 py-0.5 text-[11px] font-medium text-lor-text-tertiary-dark">
            Today
          </span>
        </div>
        <ChannelMessage person="Zoe" time="10:42 AM">
          Paygrove clicked Export three times because nothing seemed to happen.
          They ended up with three downloads. Can we make the status clearer?
        </ChannelMessage>
        <ChannelMessage person="Rafael" time="10:44 AM">
          Came up in their onboarding too. I added the details to the customer
          notes.
          <FileCard
            name="paygrove-notes.md"
            detail="Customer feedback · Export experience"
          />
        </ChannelMessage>
        <ChannelMessage person="Zoe" time="10:45 AM">
          <Mention>@Theo</Mention> I&rsquo;ll ask Lor to look at the notes and
          the export flow. Join me in the session?
        </ChannelMessage>
        <ChannelMessage person="Theo" time="10:47 AM">
          Yep. Let&rsquo;s find where they get stuck, then I can take it into
          code.
        </ChannelMessage>
      </div>
      <div aria-hidden="true" className="shrink-0 px-4 pt-2 pb-4 sm:px-6">
        <div className="rounded-lg border border-lor-border-dark bg-lor-surface-dark/40 px-3.5 py-3 text-lor-text-tertiary-dark">
          <p className="text-[13px]">
            Message #product, or @Lor to start a session
          </p>
          <div className="mt-5 flex items-center justify-between">
            <HugeiconsIcon icon={PlusSignIcon} size={16} />
            <HugeiconsIcon icon={SentIcon} size={16} />
          </div>
        </div>
      </div>
    </div>
  )
}
