import { GithubIcon, HashtagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { SidebarInset, SidebarProvider } from "@repo/ui/components/sidebar"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { AnimatePresence, motion } from "motion/react"
import { type CSSProperties, useEffect, useRef, useState } from "react"
import { PrototypeComposer } from "./prototype-composer"
import {
  type Channel,
  type ChatMessage,
  channels,
  initialChats,
  initialSessions,
  me,
  type Session,
  type SessionState,
  titleFromPrompt,
} from "./prototype-data"
import { PrototypeSidebar, SessionStateIndicator } from "./prototype-sidebar"

type View =
  | { kind: "channel"; channelId: string }
  | { kind: "session"; sessionId: string }
  | { kind: "new" }

export function SessionsPrototype() {
  const [sessions, setSessions] = useState(initialSessions)
  const [chats, setChats] = useState(initialChats)
  const [view, setView] = useState<View>({
    kind: "channel",
    channelId: "engineering",
  })
  const [started, setStarted] = useState<Session | null>(null)
  const timers = useRef<number[]>([])
  const startedCount = useRef(0)

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) window.clearTimeout(timer)
    }
  }, [])

  const later = (callback: () => void, ms: number) => {
    timers.current.push(window.setTimeout(callback, ms))
  }

  const setSessionState = (sessionId: string, state: SessionState) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, state } : session
      )
    )
  }

  const openSession = (sessionId: string) => {
    setView({ kind: "session", sessionId })
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.state === "unread"
          ? { ...session, state: "idle" }
          : session
      )
    )
  }

  const startSession = (channelId: string, prompt: string) => {
    startedCount.current += 1
    const session: Session = {
      id: crypto.randomUUID(),
      channelId,
      title: titleFromPrompt(prompt),
      state: "running",
    }
    const finalState: SessionState =
      startedCount.current % 3 === 0 ? "needs_you" : "unread"
    setSessions((prev) => [session, ...prev])
    setStarted(session)
    later(
      () => setSessionState(session.id, finalState),
      3000 + Math.random() * 3000
    )
    later(
      () =>
        setStarted((current) => (current?.id === session.id ? null : current)),
      4000
    )
  }

  const postMessage = (channelId: string, text: string) => {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      kind: "person",
      author: me,
      time: "Now",
      text,
    }
    setChats((prev) => ({
      ...prev,
      [channelId]: [...(prev[channelId] ?? []), message],
    }))
  }

  const activeChannel =
    view.kind === "channel"
      ? channels.find((channel) => channel.id === view.channelId)
      : undefined
  const activeSession =
    view.kind === "session"
      ? sessions.find((session) => session.id === view.sessionId)
      : undefined

  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-sidebar text-foreground">
      <SidebarProvider
        className="h-full min-h-0 overflow-hidden"
        style={{ "--sidebar-width": "248px" } as CSSProperties}
      >
        <PrototypeSidebar
          sessions={sessions}
          activeChannelId={activeChannel?.id ?? null}
          activeSessionId={activeSession?.id ?? null}
          newSessionActive={view.kind === "new"}
          onSelectChannel={(channelId) =>
            setView({ kind: "channel", channelId })
          }
          onSelectSession={openSession}
          onNewSession={() => setView({ kind: "new" })}
        />
        <SidebarInset className="min-w-0 md:my-2 md:mr-2 md:rounded-xl md:border md:border-border/60 md:shadow-none">
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden md:rounded-[inherit]">
            {activeChannel && (
              <ChannelView
                key={activeChannel.id}
                channel={activeChannel}
                messages={chats[activeChannel.id] ?? []}
                started={started}
                onSend={(text, toLor) =>
                  toLor
                    ? startSession(activeChannel.id, text)
                    : postMessage(activeChannel.id, text)
                }
                onOpenSession={openSession}
              />
            )}
            {activeSession && <NextChunk title={activeSession.title} />}
            {view.kind === "new" && <NextChunk title="New session" />}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

function ChannelView({
  channel,
  messages,
  started,
  onSend,
  onOpenSession,
}: {
  channel: Channel
  messages: ChatMessage[]
  started: Session | null
  onSend: (text: string, toLor: boolean) => void
  onOpenSession: (sessionId: string) => void
}) {
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <HugeiconsIcon
          icon={HashtagIcon}
          className="size-5 shrink-0 text-muted-foreground"
          strokeWidth={2}
        />
        <span className="font-semibold">{channel.name}</span>
        {channel.topic && (
          <>
            <div className="mx-2 h-4 w-px bg-border" />
            <span className="truncate text-sm text-muted-foreground">
              {channel.topic}
            </span>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-end py-4">
          {messages.length === 0 && (
            <p className="px-4 text-sm text-muted-foreground">
              No messages in #{channel.name} yet.
            </p>
          )}
          {messages.map((message) => (
            <ChatRow
              key={message.id}
              message={message}
              onOpenSession={onOpenSession}
            />
          ))}
        </div>
      </div>
      <div className="relative shrink-0 px-4 pb-3">
        <AnimatePresence>
          {started && (
            <motion.div
              key={started.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: EASE_OUT }}
              className="absolute bottom-full left-4 mb-1 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground backdrop-blur"
            >
              <SessionStateIndicator state="running" />
              <span className="truncate">
                Started{" "}
                <span className="font-medium text-foreground">
                  {started.title}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onOpenSession(started.id)}
                className="shrink-0 cursor-pointer font-medium text-agent hover:underline"
              >
                Open
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <PrototypeComposer channelName={channel.name} onSend={onSend} />
      </div>
    </>
  )
}

function ChatRow({
  message,
  onOpenSession,
}: {
  message: ChatMessage
  onOpenSession: (sessionId: string) => void
}) {
  if (message.kind === "event") {
    return (
      <div className="flex gap-3 px-4 py-1.5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06]">
          <HugeiconsIcon icon={GithubIcon} className="size-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <MessageMeta name="GitHub" time={message.time} />
          <p className="text-sm text-muted-foreground">{message.text}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 px-4 py-1.5">
      <Avatar className="mt-0.5 size-10">
        <AvatarImage src={message.author.image} alt={message.author.name} />
        <AvatarFallback fallbackSeed={message.author.name}>
          {message.author.name.charAt(0)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <MessageMeta name={message.author.name} time={message.time} />
        <p className="text-sm leading-relaxed">
          <MentionText text={message.text} />
        </p>
        {message.kind === "share" && (
          <div className="mt-2 max-w-md rounded-lg border border-border bg-foreground/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <img src="/lor-mark.svg" alt="" className="size-3.5" />
              From session
              <span className="truncate font-medium text-foreground">
                {message.sessionTitle}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-foreground/90">
              {message.excerpt}
            </p>
            <button
              type="button"
              onClick={() => onOpenSession(message.sessionId)}
              className="mt-2 cursor-pointer text-xs font-medium text-agent hover:underline"
            >
              Open session
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function MessageMeta({ name, time }: { name: string; time: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-sm font-semibold leading-snug">{name}</span>
      <span className="text-xs text-muted-foreground">{time}</span>
    </div>
  )
}

function MentionText({ text }: { text: string }) {
  let offset = 0
  const parts = text.split(/(@\w+)/g).map((part) => {
    const key = offset
    offset += part.length
    return { key, part }
  })
  return parts.map(({ key, part }) =>
    part.startsWith("@") ? (
      <span key={key} className="font-medium text-primary">
        {part}
      </span>
    ) : (
      <span key={key}>{part}</span>
    )
  )
}

function NextChunk({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
      <span className="font-semibold">{title}</span>
      <span className="text-sm text-muted-foreground">
        This screen comes in the next prototype chunk.
      </span>
    </div>
  )
}
