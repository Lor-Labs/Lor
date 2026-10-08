import { GithubIcon, HashtagIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
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
  initialTranscripts,
  me,
  mentionedPeople,
  people,
  type Session,
  type SessionMessage,
  type SessionState,
  seedMessageIds,
  titleFromPrompt,
} from "./prototype-data"
import { MentionText, PersonAvatar } from "./prototype-parts"
import {
  PrototypeSidebar,
  SESSION_CAP,
  SessionStateIndicator,
  toggleIn,
} from "./prototype-sidebar"
import { SessionView } from "./session-view"

const LOR_REPLY =
  "I looked into this and wrote up what I found. The sources are in **Files** on the right, and the plan shows what is left."

function lorReply(): SessionMessage {
  return { id: crypto.randomUUID(), kind: "lor", text: LOR_REPLY }
}

function fallbackTranscript(session: Session): SessionMessage[] {
  const author =
    Object.values(people).find(
      (person) => person.id === session.subscriberIds[0]
    ) ?? me
  const prompt: SessionMessage = {
    id: `${session.id}-prompt`,
    kind: "person",
    author,
    text: `@Lor ${session.title}`,
    toLor: true,
  }
  if (session.state === "running") return [prompt]
  const reply: SessionMessage = {
    id: `${session.id}-reply`,
    kind: "lor",
    text: LOR_REPLY,
  }
  if (session.state !== "needs_you") return [prompt, reply]
  return [
    prompt,
    reply,
    {
      id: `${session.id}-approval`,
      kind: "approval",
      action: `Apply the changes for "${session.title}"`,
    },
  ]
}

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
  const [collapsed, setCollapsed] = useState(() => new Set(["product"]))
  const [expanded, setExpanded] = useState(() => new Set<string>())
  const [transcripts, setTranscripts] = useState(initialTranscripts)
  const [seeds, setSeeds] = useState(seedMessageIds)
  const [started, setStarted] = useState<Session | null>(null)
  const timers = useRef<number[]>([])
  const startedCount = useRef(0)
  const openSessionId = useRef<string | null>(null)
  openSessionId.current = view.kind === "session" ? view.sessionId : null

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) window.clearTimeout(timer)
    }
  }, [])

  const later = (callback: () => void, ms: number) => {
    timers.current.push(window.setTimeout(callback, ms))
  }

  const updateSession = (sessionId: string, patch: Partial<Session>) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, ...patch } : session
      )
    )
  }

  const setSessionState = (sessionId: string, state: SessionState) =>
    updateSession(sessionId, { state })

  const appendToTranscript = (sessionId: string, message: SessionMessage) => {
    setTranscripts((prev) => {
      const session = sessions.find((item) => item.id === sessionId)
      const current =
        prev[sessionId] ?? (session ? fallbackTranscript(session) : [])
      return { ...prev, [sessionId]: [...current, message] }
    })
  }

  const finishLorTurn = (sessionId: string, needsYou: boolean) => {
    appendToTranscript(sessionId, lorReply())
    if (needsYou) {
      appendToTranscript(sessionId, {
        id: crypto.randomUUID(),
        kind: "approval",
        action: "Open a pull request with these changes",
      })
    }
    const isOpen = openSessionId.current === sessionId
    setSessionState(
      sessionId,
      needsYou ? "needs_you" : isOpen ? "idle" : "unread"
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
      subscriberIds: [
        me.id,
        ...mentionedPeople(prompt).map((person) => person.id),
      ],
    }
    const needsYou = startedCount.current % 3 === 0
    const alertsAhead = sessions.filter(
      (item) =>
        item.channelId === channelId &&
        item.state === "needs_you" &&
        !item.archivedBy &&
        item.subscriberIds.includes(me.id)
    ).length
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.delete(channelId)
      return next
    })
    if (alertsAhead >= SESSION_CAP) {
      setExpanded((prev) => new Set(prev).add(channelId))
    }
    setSessions((prev) => [session, ...prev])
    setTranscripts((prev) => ({
      ...prev,
      [session.id]: [
        {
          id: crypto.randomUUID(),
          kind: "person",
          author: me,
          text: prompt,
          toLor: true,
        },
      ],
    }))
    setSeeds((prev) => ({
      ...prev,
      [session.id]: (chats[channelId] ?? [])
        .slice(-3)
        .map((message) => message.id),
    }))
    setStarted(session)
    later(
      () => finishLorTurn(session.id, needsYou),
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

  const sendInSession = (session: Session, text: string, toLor: boolean) => {
    appendToTranscript(session.id, {
      id: crypto.randomUUID(),
      kind: "person",
      author: me,
      text,
      toLor,
    })
    const added = mentionedPeople(text)
      .map((person) => person.id)
      .filter((id) => !session.subscriberIds.includes(id))
    const subscriberIds = session.subscriberIds.includes(me.id)
      ? session.subscriberIds
      : [...session.subscriberIds, me.id]
    updateSession(session.id, {
      subscriberIds: [...subscriberIds, ...added],
      ...(toLor ? { state: "running" as const } : {}),
    })
    if (toLor) later(() => finishLorTurn(session.id, false), 2500)
  }

  const approve = (session: Session, messageId: string) => {
    setTranscripts((prev) => ({
      ...prev,
      [session.id]: (prev[session.id] ?? fallbackTranscript(session)).map(
        (message) =>
          message.id === messageId && message.kind === "approval"
            ? { ...message, approved: true }
            : message
      ),
    }))
    setSessionState(session.id, "running")
    later(() => finishLorTurn(session.id, false), 2000)
  }

  const activeChannel =
    view.kind === "channel"
      ? channels.find((channel) => channel.id === view.channelId)
      : undefined
  const activeSession =
    view.kind === "session"
      ? sessions.find((session) => session.id === view.sessionId)
      : undefined
  const sidebarSessions = sessions.filter(
    (session) => !session.archivedBy && session.subscriberIds.includes(me.id)
  )
  const sessionChannel = channels.find(
    (channel) => channel.id === activeSession?.channelId
  )
  const sessionSeed = activeSession
    ? (chats[activeSession.channelId] ?? []).filter((message) =>
        seeds[activeSession.id]?.includes(message.id)
      )
    : []

  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-sidebar text-foreground">
      <SidebarProvider
        className="h-full min-h-0 overflow-hidden"
        style={{ "--sidebar-width": "248px" } as CSSProperties}
      >
        <PrototypeSidebar
          sessions={sidebarSessions}
          collapsed={collapsed}
          expanded={expanded}
          onToggleCollapsed={(channelId) =>
            setCollapsed((prev) => toggleIn(prev, channelId))
          }
          onToggleExpanded={(channelId) =>
            setExpanded((prev) => toggleIn(prev, channelId))
          }
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
            {activeSession && sessionChannel && (
              <SessionView
                key={activeSession.id}
                session={activeSession}
                channelName={sessionChannel.name}
                transcript={
                  transcripts[activeSession.id] ??
                  fallbackTranscript(activeSession)
                }
                seed={sessionSeed}
                onSend={(text, toLor) =>
                  sendInSession(activeSession, text, toLor)
                }
                onSetSubscribers={(subscriberIds) =>
                  updateSession(activeSession.id, { subscriberIds })
                }
                onArchive={() =>
                  updateSession(activeSession.id, { archivedBy: me.id })
                }
                onUnarchive={() =>
                  updateSession(activeSession.id, { archivedBy: undefined })
                }
                onApprove={(messageId) => approve(activeSession, messageId)}
                onOpenChannel={() =>
                  setView({ kind: "channel", channelId: sessionChannel.id })
                }
              />
            )}
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
        <PrototypeComposer
          mode="channel"
          channelName={channel.name}
          onSend={onSend}
        />
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
      <PersonAvatar person={message.author} className="mt-0.5 size-10" />
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
