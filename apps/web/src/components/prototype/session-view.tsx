import {
  Archive03Icon,
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  File02Icon,
  HashtagIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { cn } from "@repo/ui/lib/utils"
import { type ReactNode, useEffect, useState } from "react"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { PrototypeComposer } from "./prototype-composer"
import {
  type ChatMessage,
  me,
  people,
  plans,
  type Session,
  type SessionMessage,
  sessionFiles,
} from "./prototype-data"
import { MentionText, PersonAvatar } from "./prototype-parts"
import { SessionStateIndicator } from "./prototype-sidebar"

const everyone = Object.values(people)

export function SessionView({
  session,
  channelName,
  transcript,
  seed,
  onSend,
  onSetSubscribers,
  onArchive,
  onUnarchive,
  onApprove,
  onOpenChannel,
}: {
  session: Session
  channelName: string
  transcript: SessionMessage[]
  seed: ChatMessage[]
  onSend: (text: string, toLor: boolean) => void
  onSetSubscribers: (subscriberIds: string[]) => void
  onArchive: () => void
  onUnarchive: () => void
  onApprove: (messageId: string) => void
  onOpenChannel: () => void
}) {
  const subscribed = session.subscriberIds.includes(me.id)
  const archivedBy = everyone.find((person) => person.id === session.archivedBy)

  const toggleSubscribed = () =>
    onSetSubscribers(
      subscribed
        ? session.subscriberIds.filter((id) => id !== me.id)
        : [...session.subscriberIds, me.id]
    )

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <span className="truncate font-semibold">{session.title}</span>
          <button
            type="button"
            onClick={onOpenChannel}
            className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <HugeiconsIcon
              icon={HashtagIcon}
              className="size-3.5"
              strokeWidth={2}
            />
            {channelName}
          </button>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={toggleSubscribed}>
              {subscribed ? "Unsubscribe" : "Subscribe"}
            </Button>
            <SubscribersMenu
              subscriberIds={session.subscriberIds}
              onChange={onSetSubscribers}
            />
            {!archivedBy && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Archive session"
                title="Archive for everyone"
                onClick={onArchive}
              >
                <HugeiconsIcon
                  icon={Archive03Icon}
                  className="size-4"
                  strokeWidth={2}
                />
              </Button>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
            {seed.length > 0 && (
              <SeedBlock channelName={channelName} messages={seed} />
            )}
            {transcript.map((message) => (
              <TranscriptItem
                key={message.id}
                message={message}
                onApprove={onApprove}
              />
            ))}
            {session.state === "running" && (
              <div className="flex items-center gap-2 text-sm text-agent">
                <SessionStateIndicator state="running" />
                Lor is working
              </div>
            )}
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-3">
          {archivedBy ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-input bg-muted/40 px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">
                Archived by {archivedBy.name}. It left everyone's sidebar.
              </span>
              <Button size="sm" variant="outline" onClick={onUnarchive}>
                Unarchive
              </Button>
            </div>
          ) : (
            <PrototypeComposer
              mode="session"
              channelName={channelName}
              onSend={onSend}
            />
          )}
        </div>
      </div>

      <SessionRail
        sessionId={session.id}
        running={session.state === "running"}
      />
    </div>
  )
}

function SubscribersMenu({
  subscriberIds,
  onChange,
}: {
  subscriberIds: string[]
  onChange: (subscriberIds: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const subscribers = everyone.filter((person) =>
    subscriberIds.includes(person.id)
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const toggle = (personId: string, checked: boolean) =>
    onChange(
      checked
        ? [...subscriberIds, personId]
        : subscriberIds.filter((id) => id !== personId)
    )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Change subscribers"
            className="flex cursor-pointer -space-x-1.5 rounded-full p-0.5 hover:bg-foreground/[0.06]"
          />
        }
      >
        {subscribers.map((person) => (
          <PersonAvatar
            key={person.id}
            person={person}
            className="size-6 ring-2 ring-background"
          />
        ))}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            Change subscribers…
            <span className="text-[11px] text-muted-foreground">⌘⇧S</span>
          </DropdownMenuLabel>
          {everyone.map((person) => (
            <DropdownMenuCheckboxItem
              key={person.id}
              checked={subscriberIds.includes(person.id)}
              onCheckedChange={(checked) => toggle(person.id, checked)}
            >
              <span className="flex items-center gap-2">
                <PersonAvatar person={person} className="size-5" />
                {person.name}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SeedBlock({
  channelName,
  messages,
}: {
  channelName: string
  messages: ChatMessage[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-border/70 bg-foreground/[0.02]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <HugeiconsIcon
          icon={HashtagIcon}
          className="size-3.5"
          strokeWidth={2}
        />
        From #{channelName} · {messages.length} messages
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className={cn(
            "ml-auto size-3.5 transition-transform",
            !open && "-rotate-90"
          )}
          strokeWidth={2}
        />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border/70 px-3 py-2">
          {messages.map((message) => (
            <p key={message.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {message.kind === "event" ? "GitHub" : message.author.name}
              </span>{" "}
              {message.text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function TranscriptItem({
  message,
  onApprove,
}: {
  message: SessionMessage
  onApprove: (messageId: string) => void
}) {
  if (message.kind === "lor") {
    return (
      <div>
        <div className="mb-2 flex items-center gap-2">
          <img src="/lor-mark.svg" alt="" className="size-5" />
          <span className="text-sm font-semibold">Lor</span>
          {message.steps && (
            <span className="truncate text-xs text-muted-foreground">
              {message.steps}
            </span>
          )}
        </div>
        <MessageMarkdown
          content={message.text}
          mentions={[]}
          className="text-[15px] leading-7"
        />
      </div>
    )
  }

  if (message.kind === "approval") {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {message.approved ? (
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="size-4 text-success"
              strokeWidth={2}
            />
          ) : (
            <SessionStateIndicator state="needs_you" />
          )}
          {message.approved ? "Approved" : "Needs approval"}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{message.action}</p>
        {!message.approved && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => onApprove(message.id)}>
              Approve
            </Button>
            <Button size="sm" variant="ghost">
              Deny
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-2.5">
      <PersonAvatar person={message.author} className="mt-0.5 size-6" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{message.author.name}</span>
          {!message.toLor && (
            <span className="text-xs text-muted-foreground">to people</span>
          )}
        </div>
        <p className="text-sm leading-relaxed">
          <MentionText text={message.text} />
        </p>
      </div>
    </div>
  )
}

function SessionRail({
  sessionId,
  running,
}: {
  sessionId: string
  running: boolean
}) {
  const steps = plans[sessionId] ?? []
  const files = sessionFiles[sessionId] ?? []

  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-6 overflow-y-auto border-l border-border px-4 py-4 lg:flex">
      <RailSection title="Plan">
        {steps.length === 0 && <RailEmpty>No plan yet</RailEmpty>}
        {steps.map((step) => (
          <div key={step.label} className="flex items-center gap-2 text-sm">
            {step.done ? (
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="size-4 shrink-0 text-success"
                strokeWidth={2}
              />
            ) : (
              <span className="size-4 shrink-0 rounded-full border border-muted-foreground/40" />
            )}
            <span className={cn(step.done && "text-muted-foreground")}>
              {step.label}
            </span>
          </div>
        ))}
      </RailSection>
      <RailSection title="Files">
        {files.length === 0 && <RailEmpty>No files yet</RailEmpty>}
        {files.map((file) => (
          <div
            key={file}
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <HugeiconsIcon
              icon={File02Icon}
              className="size-4 shrink-0"
              strokeWidth={2}
            />
            <span className="truncate">{file}</span>
          </div>
        ))}
      </RailSection>
      <RailSection title="Computer">
        <div className="rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
          {running ? (
            <>
              $ pnpm db:migrate --dry-run
              <br />
              checking advisory locks…
            </>
          ) : (
            "Idle"
          )}
        </div>
      </RailSection>
    </aside>
  )
}

function RailSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function RailEmpty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground/70">{children}</p>
}
