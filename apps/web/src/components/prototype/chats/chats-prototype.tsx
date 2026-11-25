import {
  Alert02Icon,
  Archive02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp02Icon,
  Cancel01Icon,
  DiscordIcon,
  GitBranchIcon,
  Infinity01Icon,
  LinkSquare02Icon,
  LockIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  PlusSignIcon,
  Search01Icon,
  SidebarRight01Icon,
  SlackIcon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import type { CreatureState } from "@repo/utils/bestiary"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { AgentFace } from "@/components/agent/agent-face"
import {
  AGENTS,
  type Agent,
  agentById,
  CHATS,
  type Chat,
  EXCHANGES,
  type Exchange,
  type Message,
  OWN_SESSIONS,
  PEOPLE,
  type Place,
  personById,
  type Session,
  YOU,
} from "./chats-data"

// Dev-only mock of where reference/agents-and-chats.md is heading: Lor as
// named group chats, each with people and agents. The sidebar lists chats in
// Lor's own sidebar language, pinned ones first. A chat's header opens the
// right panel with who is in it, and New chat is a start screen. Nothing has
// a status, a kind or a project yet.

const PRESS =
  "transition-[transform,background-color,color,border-color] duration-150 ease-out active:scale-[0.98]"
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
const SPRING = { type: "spring", bounce: 0, duration: 0.4 } as const

type View =
  | { kind: "chat"; id: string }
  // chatId is null for a session of your own, under no chat.
  | { kind: "session"; chatId: string | null; id: string }
  | { kind: "new" }
type Panel =
  | { kind: "details" }
  | { kind: "agent"; id: string }
  // One agent's question to another, read-only.
  | { kind: "exchange"; id: string }
  | null

const PLACE_NAME: Record<Place, string> = {
  lor: "Lor",
  slack: "Slack",
  discord: "Discord",
}

const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" })

const nameOf = (id: string) => agentById(id)?.name ?? personById(id)?.name ?? ""

// Just you and one agent: it reads every message, and the chat is named
// after it.
const isDirect = (chat: Pick<Chat, "agentIds" | "people">) =>
  chat.agentIds.length === 1 && chat.people.length === 1

// What an unnamed chat is called: who is in it.
function membersName(agentIds: string[], people: string[]) {
  return LIST.format([...agentIds, ...people].map(nameOf).filter(Boolean))
}

function PlaceMark({ place, className }: { place: Place; className?: string }) {
  if (place === "lor") {
    return (
      <img src="/lor-mark.svg" alt="" className={cn("size-3.5", className)} />
    )
  }
  return (
    <HugeiconsIcon
      icon={place === "slack" ? SlackIcon : DiscordIcon}
      className={cn("size-3.5 shrink-0", className)}
      strokeWidth={1.8}
    />
  )
}

function Avatar({ id, size = 24 }: { id: string; size?: number }) {
  const person = personById(id)
  return (
    <span
      title={person?.name}
      style={{
        width: size,
        height: size,
        background: person?.color,
        fontSize: Math.max(8, Math.round(size * 0.42)),
      }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
    >
      {person?.name.slice(0, 1)}
    </span>
  )
}

// An agent's face or a person's avatar, by id.
function Face({
  id,
  size,
  state = "idle",
  still,
}: {
  id: string
  size: number
  state?: CreatureState
  still?: boolean
}) {
  const agent = agentById(id)
  return agent ? (
    <AgentFace
      creature={agent.creature}
      size={size}
      state={state}
      still={still}
    />
  ) : (
    <Avatar id={id} size={size} />
  )
}

function IconButton({
  icon,
  label,
  active,
  onClick,
  className,
}: {
  icon: IconSvgElement
  label: string
  active?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        PRESS,
        FOCUS,
        "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.96]",
        active
          ? "bg-foreground/[0.06] text-foreground"
          : "text-muted-foreground",
        className
      )}
    >
      <HugeiconsIcon icon={icon} className="size-4" strokeWidth={2} />
    </button>
  )
}

// Where the faces of a chat sit inside its round avatar, by how many show.
// Laid out for a 44px circle and scaled to the size asked for.
const CLUSTER: Record<number, { x: number; y: number; size: number }[]> = {
  1: [{ x: 7, y: 7, size: 30 }],
  2: [
    { x: 4, y: 9, size: 22 },
    { x: 23, y: 17, size: 17 },
  ],
  3: [
    { x: 12, y: 5, size: 20 },
    { x: 6, y: 23, size: 15 },
    { x: 23, y: 23, size: 15 },
  ],
  4: [
    { x: 5, y: 5, size: 18 },
    { x: 25, y: 7, size: 14 },
    { x: 7, y: 25, size: 14 },
    { x: 23, y: 23, size: 16 },
  ],
}

// A chat's face: its agents, then the people in it besides you. An agent on
// a turn looks about. `grow` is for New chat, where faces arrive one by one.
function ChatAvatar({
  agentIds,
  people,
  size = 40,
  working = [],
  place = "lor",
  grow,
}: {
  agentIds: string[]
  people: string[]
  size?: number
  working?: string[]
  place?: Place
  grow?: boolean
}) {
  const reduced = useReducedMotion()
  const all = [...agentIds, ...people.filter((id) => id !== YOU)]
  // More than fit: three faces and a count.
  const shown = all.length > 4 ? all.slice(0, 3) : all
  const spots = CLUSTER[Math.min(all.length, 4)] ?? []
  const k = size / 44
  const at = (index: number) => {
    const spot = spots[index] ?? { x: 0, y: 0, size: 0 }
    return {
      size: Math.round(spot.size * k),
      style: { left: Math.round(spot.x * k), top: Math.round(spot.y * k) },
    }
  }
  const more = at(3)
  return (
    <span
      className="relative block shrink-0 rounded-full bg-foreground/[0.07]"
      style={{ width: size, height: size }}
    >
      <AnimatePresence initial={false}>
        {shown.map((id, index) => {
          const spot = at(index)
          const busy = working.includes(id)
          const face = {
            id,
            size: spot.size,
            state: busy ? ("working" as const) : ("idle" as const),
            still: !busy && size < 56,
          }
          return grow && !reduced ? (
            <motion.span
              key={id}
              layout="position"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={SPRING}
              className="absolute"
              style={spot.style}
            >
              <Face {...face} />
            </motion.span>
          ) : (
            <span key={id} className="absolute" style={spot.style}>
              <Face {...face} />
            </span>
          )
        })}
      </AnimatePresence>
      {all.length > 4 && (
        <span
          className="absolute flex items-center justify-center rounded-full bg-foreground/15 font-semibold text-foreground/80"
          style={{
            ...more.style,
            width: more.size,
            height: more.size,
            fontSize: Math.max(8, Math.round(more.size * 0.5)),
          }}
        >
          +{all.length - 3}
        </span>
      )}
      {/* A chat that lives in the team's own chat app carries its mark. */}
      {place !== "lor" && (
        <span className="-right-0.5 -bottom-0.5 absolute flex size-4 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <PlaceMark place={place} className="size-2.5" />
        </span>
      )}
    </span>
  )
}

// The line under a chat's name: who is working in it now, else who spoke
// last and what they said.
function Preview({ chat, unread }: { chat: Chat; unread: boolean }) {
  const busy = chat.working?.[0]
  if (busy) {
    const others = (chat.working?.length ?? 1) - 1
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-agent">
        <Face id={busy} size={14} state="working" />
        <span className="truncate">
          {nameOf(busy)}
          {others > 0 ? ` and ${others} more are` : " is"} working
        </span>
      </span>
    )
  }
  const last = chat.messages.at(-1)
  return (
    <span
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 text-[13px]",
        unread ? "text-foreground/85" : "text-muted-foreground"
      )}
    >
      {last && last.from !== YOU && !isDirect(chat) && (
        <Face id={last.from} size={14} still />
      )}
      <span className="truncate">
        {last
          ? `${last.from === YOU ? "You: " : ""}${last.text}`
          : "No messages yet"}
      </span>
    </span>
  )
}

function ChatRow({
  chat,
  selected,
  onOpen,
  onPin,
}: {
  chat: Chat
  selected: boolean
  onOpen: () => void
  onPin: () => void
}) {
  const unread = Boolean(chat.unread) && !selected
  return (
    <div
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out has-[[data-open]:active]:bg-foreground/[0.09]",
        selected ? "bg-foreground/[0.07]" : "hover:bg-foreground/[0.04]"
      )}
    >
      <ChatAvatar
        agentIds={chat.agentIds}
        people={chat.people}
        working={chat.working}
        place={chat.place}
      />
      {/* The whole row opens the chat, under the button that pins it. */}
      <button
        type="button"
        data-open
        onClick={onOpen}
        aria-current={selected ? "page" : undefined}
        className="min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
      >
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[14px]",
              unread ? "font-semibold" : "font-medium"
            )}
          >
            {chat.name}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums group-hover:invisible group-has-[[data-pin]:focus-visible]:invisible">
            {chat.when}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <Preview chat={chat} unread={unread} />
          {unread && (
            <span className="size-2 shrink-0 rounded-full bg-primary transition-[scale,opacity] duration-200 ease-out starting:scale-0 starting:opacity-0 motion-reduce:transition-none" />
          )}
        </span>
      </button>
      <button
        type="button"
        data-pin
        onClick={onPin}
        aria-label={chat.pinned ? `Unpin ${chat.name}` : `Pin ${chat.name}`}
        title={chat.pinned ? "Unpin" : "Pin"}
        className={cn(
          PRESS,
          FOCUS,
          "absolute top-1 right-1 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-foreground/[0.08] hover:text-foreground focus-visible:opacity-100 active:scale-[0.94] group-hover:opacity-100"
        )}
      >
        <HugeiconsIcon
          icon={chat.pinned ? PinOffIcon : PinIcon}
          className="size-3.5"
          strokeWidth={2}
        />
      </button>
    </div>
  )
}

// A session's state, as the real sidebar shows it today
// (SessionStateIndicator in channel-activity.tsx): a spinner while it works,
// a mark when it waits on a person, nothing otherwise.
function SessionMark({ session }: { session: Session }) {
  if (session.state === "running") {
    return (
      <span
        title="Working"
        className="size-3 shrink-0 rounded-full border-[1.5px] border-agent/20 border-t-agent motion-safe:animate-spin"
      />
    )
  }
  if (session.state === "needs_you") {
    return (
      <span
        title="Needs you"
        className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-warning/12 font-semibold text-[10px] text-warning-foreground"
      >
        !
      </span>
    )
  }
  return null
}

function LineCounts({ session }: { session: Session }) {
  const added = session.files.reduce((sum, file) => sum + file.added, 0)
  const removed = session.files.reduce((sum, file) => sum + file.removed, 0)
  return (
    <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums">
      <span className="text-success">+{added}</span>
      <span className="text-destructive">−{removed}</span>
    </span>
  )
}

const SESSION_ROWS = 3

// Session rows as the real sidebar has them today (channel-sessions.tsx):
// icon, title, uncommitted line counts and state, and on hover a button
// that archives. The first few show and the rest open in place. Used under
// a chat and for your own sessions.
function SessionRows({
  sessions,
  selectedId,
  onOpen,
  onArchive,
  className,
}: {
  sessions: Session[]
  selectedId: string | null
  onOpen: (id: string) => void
  onArchive: (id: string) => void
  className?: string
}) {
  const [all, setAll] = useState(false)
  if (sessions.length === 0) return null
  const open = sessions.find((session) => session.id === selectedId)
  const first = sessions.slice(0, SESSION_ROWS)
  // The one being read stays in the list while the rest are folded.
  const shown = all
    ? sessions
    : open && !first.includes(open)
      ? [...first, open]
      : first
  const more = sessions.length - shown.length
  return (
    <div className={className}>
      {shown.map((session) => {
        const active = session.id === selectedId
        return (
          <div key={session.id} className="group/session relative">
            <button
              type="button"
              onClick={() => onOpen(session.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                FOCUS,
                "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13px] transition-colors duration-150 ease-out active:bg-foreground/[0.09] group-hover/session:pr-7",
                active
                  ? "bg-foreground/[0.07] font-medium text-foreground"
                  : "text-muted-foreground group-hover/session:bg-foreground/[0.04]"
              )}
            >
              <HugeiconsIcon
                icon={SourceCodeIcon}
                className="size-3.5 shrink-0 opacity-60"
                strokeWidth={2}
              />
              <span className="min-w-0 flex-1 truncate">{session.title}</span>
              <span className="flex items-center gap-2 group-hover/session:hidden">
                {session.state !== "done" && <LineCounts session={session} />}
                <SessionMark session={session} />
              </span>
            </button>
            <button
              type="button"
              aria-label={`Archive ${session.title}`}
              title="Archive"
              onClick={() => onArchive(session.id)}
              className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-[opacity,background-color] hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 active:bg-foreground/[0.1] group-hover/session:opacity-100"
            >
              <HugeiconsIcon
                icon={Archive02Icon}
                className="size-3.5"
                strokeWidth={2}
              />
            </button>
          </div>
        )
      })}
      {more > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className={cn(
            FOCUS,
            "flex cursor-pointer items-center rounded-md px-2 py-[5px] text-[12px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
          )}
        >
          {more} more
        </button>
      )}
    </div>
  )
}

function Sidebar({
  chats,
  view,
  onView,
  onPin,
  own,
  onNewSession,
  onArchive,
}: {
  chats: Chat[]
  view: View
  onView: (view: View) => void
  onPin: (id: string) => void
  own: Session[]
  onNewSession: () => void
  onArchive: (chatId: string | null, id: string) => void
}) {
  const [query, setQuery] = useState("")
  const reduced = useReducedMotion()
  const wanted = query.trim().toLowerCase()
  const shown = wanted
    ? chats.filter(
        (chat) =>
          chat.name.toLowerCase().includes(wanted) ||
          chat.messages.some((m) => m.text.toLowerCase().includes(wanted))
      )
    : chats
  const selectedId = view.kind === "chat" ? view.id : null
  const selectedSession = view.kind === "session" ? view.id : null
  const pinned = shown.filter((chat) => chat.pinned)
  const recent = shown.filter((chat) => !chat.pinned)
  const layout = reduced ? false : ("position" as const)
  const label = (text: string) => (
    <motion.div
      key={`label-${text}`}
      layout={layout}
      transition={SPRING}
      className="px-2 pt-3 pb-1 font-medium text-[12px] text-muted-foreground"
    >
      {text}
    </motion.div>
  )
  // A chat that gets a message moves to the top of Recent; a pinned one
  // keeps its place.
  const row = (chat: Chat) => (
    <motion.div key={chat.id} layout={layout} transition={SPRING}>
      <ChatRow
        chat={chat}
        selected={chat.id === selectedId}
        onOpen={() => onView({ kind: "chat", id: chat.id })}
        onPin={() => onPin(chat.id)}
      />
      {/* Under the chat's name, as sessions sit under a channel today. */}
      <SessionRows
        sessions={chat.sessions}
        selectedId={selectedSession}
        onOpen={(id) => onView({ kind: "session", chatId: chat.id, id })}
        onArchive={(id) => onArchive(chat.id, id)}
        className="mb-1 ml-[50px]"
      />
    </motion.div>
  )
  return (
    <aside className="flex w-[300px] shrink-0 flex-col">
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-1">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 focus-within:border-foreground/25">
          <HugeiconsIcon
            icon={Search01Icon}
            className="size-3.5 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </label>
        <button
          type="button"
          onClick={() => onView({ kind: "new" })}
          aria-label="New chat"
          aria-current={view.kind === "new" ? "page" : undefined}
          title="New chat"
          className={cn(
            PRESS,
            FOCUS,
            "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground active:scale-[0.96] aria-[current=page]:bg-foreground/[0.06] aria-[current=page]:text-foreground"
          )}
        >
          <HugeiconsIcon
            icon={PencilEdit02Icon}
            className="size-3.5"
            strokeWidth={2}
          />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {pinned.length > 0 && label("Pinned")}
        {pinned.map(row)}
        {/* Sessions of your own, under no chat. Above Recent, which has no
            end, so they are never pushed out of sight. */}
        {!wanted && (
          <motion.div key="own" layout={layout} transition={SPRING}>
            <div className="flex items-center px-2 pt-3 pb-1 font-medium text-[12px] text-muted-foreground">
              <span className="flex-1">Sessions</span>
              <button
                type="button"
                onClick={onNewSession}
                aria-label="New session"
                title="New session"
                className={cn(
                  PRESS,
                  FOCUS,
                  "-mr-1 flex size-5 cursor-pointer items-center justify-center rounded hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.94]"
                )}
              >
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  className="size-3"
                  strokeWidth={2}
                />
              </button>
            </div>
            <SessionRows
              sessions={own}
              selectedId={selectedSession}
              onOpen={(id) => onView({ kind: "session", chatId: null, id })}
              onArchive={(id) => onArchive(null, id)}
            />
            {own.length === 0 && (
              <p className="px-2 py-1 text-[12px] text-muted-foreground/80">
                None of your own.
              </p>
            )}
          </motion.div>
        )}
        {recent.length > 0 && label("Recent")}
        {recent.map(row)}
        {shown.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
            No chats match "{query.trim()}".
          </p>
        )}
      </div>
    </aside>
  )
}

function SessionCard({
  session,
  onOpen,
}: {
  session: Session
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        PRESS,
        FOCUS,
        "mt-2 flex w-full max-w-md cursor-pointer items-center gap-3 rounded-xl border border-border bg-foreground/[0.03] px-3 py-2.5 text-left hover:bg-foreground/[0.06]"
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-agent/10 text-agent">
        <HugeiconsIcon
          icon={SourceCodeIcon}
          className="size-4"
          strokeWidth={2}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-[13px]">
          {session.title}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {session.summary}
        </span>
      </span>
      <SessionMark session={session} />
    </button>
  )
}

function ApprovalCard({ text }: { text: string }) {
  const [decided, setDecided] = useState<"approved" | "denied" | null>(null)
  return (
    <div className="mt-2 max-w-md rounded-xl border border-warning/40 bg-warning/[0.06] px-3 py-2.5">
      <div className="flex items-center gap-2 font-medium text-[13px]">
        <HugeiconsIcon
          icon={Alert02Icon}
          className="size-4 text-warning-foreground"
          strokeWidth={2}
        />
        Needs approval
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">{text}</p>
      {decided ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          You {decided} this.
        </p>
      ) : (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => setDecided("approved")}
            className={cn(
              PRESS,
              "h-7 cursor-pointer rounded-md bg-foreground px-3 font-medium text-[12px] text-background"
            )}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setDecided("denied")}
            className={cn(
              PRESS,
              "h-7 cursor-pointer rounded-md border border-border px-3 text-[12px] hover:bg-foreground/[0.05]"
            )}
          >
            Deny
          </button>
        </div>
      )}
    </div>
  )
}

// Under a message: the agent asked another agent while writing it. Agents
// don't talk to each other in the chat; this opens what they said.
function AskedMarker({
  exchange,
  onOpen,
}: {
  exchange: Exchange
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        PRESS,
        FOCUS,
        "mt-2 flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-foreground/[0.05] pr-2 pl-1 text-[12px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground"
      )}
    >
      <span className="flex items-center">
        <Face id={exchange.from} size={18} still />
        <span className="-ml-1.5">
          <Face id={exchange.to} size={18} still />
        </span>
      </span>
      Asked {nameOf(exchange.to)}
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        className="size-3"
        strokeWidth={2}
      />
    </button>
  )
}

function MessageRow({
  message,
  chat,
  onSession,
  onExchange,
}: {
  message: Message
  chat: Chat
  onSession: (id: string) => void
  onExchange: (id: string) => void
}) {
  const session = chat.sessions.find((item) => item.id === message.session)
  const exchange = EXCHANGES.find((item) => item.id === message.asked)
  return (
    <div className="flex gap-3">
      <Face id={message.from} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">{nameOf(message.from)}</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {message.time}
          </span>
        </div>
        <p className="text-pretty text-[14px] text-foreground/90 leading-relaxed">
          {message.text}
        </p>
        {session && (
          <SessionCard session={session} onOpen={() => onSession(session.id)} />
        )}
        {message.approval && <ApprovalCard text={message.approval} />}
        {exchange && (
          <AskedMarker
            exchange={exchange}
            onOpen={() => onExchange(exchange.id)}
          />
        )}
      </div>
    </div>
  )
}

// How the same thread looks in the team's chat app: short answers, and a
// link to Lor for what a chat app can't show.
function OutsidePreview({ chat }: { chat: Chat }) {
  return (
    <div className="mx-auto w-full max-w-2xl rounded-xl bg-white p-5 text-[#1d1c1d] shadow-lg">
      <div className="flex items-center gap-2 border-black/10 border-b pb-3 font-bold text-[15px]">
        <PlaceMark place={chat.place} className="size-4" />
        Thread in {chat.origin}
      </div>
      <div className="space-y-4 pt-4">
        {chat.messages.map((message) => {
          const agent = agentById(message.from)
          const session = chat.sessions.find(
            (item) => item.id === message.session
          )
          return (
            <div key={message.id} className="flex gap-3">
              {agent ? (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#f3f0ff]">
                  <AgentFace creature={agent.creature} size={26} state="idle" />
                </span>
              ) : (
                <Avatar id={message.from} size={36} />
              )}
              <div className="min-w-0 flex-1 text-[14px] leading-relaxed">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold">{nameOf(message.from)}</span>
                  {agent && (
                    <span className="rounded bg-black/[0.08] px-1 font-semibold text-[10px] text-black/60">
                      APP
                    </span>
                  )}
                  <span className="text-[12px] text-black/50">
                    {message.time}
                  </span>
                </div>
                <p>{message.text}</p>
                {(session || message.approval) && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[#1264a3] text-[13px]">
                    <HugeiconsIcon
                      icon={LinkSquare02Icon}
                      className="size-3.5"
                      strokeWidth={2}
                    />
                    {session
                      ? `Watch the session in Lor · ${session.branch}`
                      : "Approve in Lor"}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ChatView({
  chat,
  detailsOpen,
  onDetails,
  onPin,
  onSend,
  onSession,
  onExchange,
}: {
  chat: Chat
  detailsOpen: boolean
  onDetails: () => void
  onPin: () => void
  onSend: (text: string) => void
  onSession: (id: string) => void
  onExchange: (id: string) => void
}) {
  const [text, setText] = useState("")
  const [outside, setOutside] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const elsewhere = chat.place !== "lor"
  const direct = isDirect(chat)
  const working = chat.working ?? []
  const lower = text.toLowerCase()
  const mentions = (id: string) =>
    lower.includes(`@${nameOf(id).toLowerCase()}`)

  // Keeps the newest message, or the agent starting on it, in view.
  const latest = `${chat.messages.length}-${working.length}`
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [latest])

  const send = () => {
    if (!text.trim()) return
    onSend(text.trim())
    setText("")
  }
  // An agent's chip puts its name on the message, or takes it off.
  const address = (id: string) => {
    const tag = `@${nameOf(id)}`
    setText((value) =>
      value.toLowerCase().includes(tag.toLowerCase())
        ? value.replace(new RegExp(`${tag}\\s?`, "i"), "")
        : `${tag} ${value}`
    )
    input.current?.focus()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 border-border/60 border-b pr-3 pl-3">
        {/* Who is in the chat is in the right panel: the header opens it. */}
        <button
          type="button"
          onClick={onDetails}
          aria-expanded={detailsOpen}
          title="Who is in this chat"
          className={cn(
            PRESS,
            FOCUS,
            "flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg py-1 pr-3 pl-1.5 hover:bg-foreground/[0.05]"
          )}
        >
          <ChatAvatar
            agentIds={chat.agentIds}
            people={chat.people}
            working={working}
            size={34}
          />
          <span className="truncate font-semibold text-[15px]">
            {chat.name}
          </span>
          {elsewhere && (
            <span className="flex shrink-0 items-center gap-1 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[12px] text-muted-foreground">
              <PlaceMark place={chat.place} className="size-3" />
              {chat.origin}
            </span>
          )}
        </button>
        <span className="flex-1" />
        {elsewhere && (
          <div className="mr-1 flex rounded-lg bg-foreground/[0.05] p-0.5 text-[12px]">
            {[false, true].map((value) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => setOutside(value)}
                aria-pressed={outside === value}
                className={cn(
                  "cursor-pointer rounded-md px-2.5 py-1 transition-colors duration-150",
                  outside === value
                    ? "bg-background font-medium shadow-sm dark:bg-foreground/10"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {value ? `In ${PLACE_NAME[chat.place]}` : "In Lor"}
              </button>
            ))}
          </div>
        )}
        <IconButton
          icon={chat.pinned ? PinOffIcon : PinIcon}
          label={chat.pinned ? "Unpin chat" : "Pin chat"}
          onClick={onPin}
        />
        <IconButton
          icon={SidebarRight01Icon}
          label="Details"
          active={detailsOpen}
          onClick={onDetails}
        />
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        {outside ? (
          <OutsidePreview chat={chat} />
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
            {chat.messages.length === 0 && working.length === 0 && (
              <p className="py-16 text-center text-[13px] text-muted-foreground">
                Nothing said yet.
              </p>
            )}
            {chat.messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                chat={chat}
                onSession={onSession}
                onExchange={onExchange}
              />
            ))}
            {working.map((id) => (
              <div
                key={id}
                className="fade-in-0 flex animate-in items-center gap-3 text-[13px] text-agent duration-200 motion-reduce:animate-none"
              >
                <span className="flex size-8 shrink-0 items-center justify-center">
                  <Face id={id} size={26} state="working" />
                </span>
                {nameOf(id)} is working
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-5 pb-5">
        <div className="mx-auto w-full max-w-2xl">
          {elsewhere ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-foreground/[0.03] px-4 py-3 text-[13px] text-muted-foreground">
              <PlaceMark place={chat.place} className="size-4" />
              <span className="flex-1">
                People talk in {PLACE_NAME[chat.place]}. Lor keeps the record
                and holds the work: sessions, diffs, approvals.
              </span>
              <span className="flex items-center gap-1 font-medium text-foreground">
                Open in {PLACE_NAME[chat.place]}
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className="size-3.5"
                  strokeWidth={2}
                />
              </span>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-background/40 transition-colors duration-150 focus-within:border-foreground/25">
              <textarea
                ref={input}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    send()
                  }
                }}
                rows={1}
                placeholder={
                  direct
                    ? `Message ${nameOf(chat.agentIds[0] ?? "")}`
                    : `Message ${chat.name}`
                }
                className="block min-h-10 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14px] outline-none placeholder:text-muted-foreground"
              />
              <div className="flex min-h-11 items-center gap-1 pr-2 pb-2 pl-2.5">
                {direct ? (
                  <span className="px-1.5 text-[12px] text-muted-foreground">
                    {nameOf(chat.agentIds[0] ?? "")} reads every message here
                  </span>
                ) : chat.agentIds.length === 0 ? (
                  <span className="px-1.5 text-[12px] text-muted-foreground">
                    No agent in this chat
                  </span>
                ) : (
                  // Several agents can be in a chat: the ones named on a
                  // message answer it.
                  chat.agentIds.map((id) => {
                    const asked = mentions(id)
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => address(id)}
                        aria-pressed={asked}
                        title={
                          asked
                            ? `${nameOf(id)} will answer`
                            : `Ask ${nameOf(id)}`
                        }
                        className={cn(
                          PRESS,
                          FOCUS,
                          "flex h-7 cursor-pointer items-center gap-1.5 rounded-full pr-2.5 pl-1 text-[12px] active:scale-[0.96]",
                          asked
                            ? "bg-agent/12 text-agent"
                            : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                        )}
                      >
                        <Face id={id} size={18} still />@{nameOf(id)}
                      </button>
                    )
                  })
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={send}
                  disabled={!text.trim()}
                  aria-label="Send"
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 ease-out",
                    text.trim()
                      ? "cursor-pointer bg-primary text-primary-foreground active:scale-[0.94]"
                      : "bg-foreground/[0.07] text-muted-foreground"
                  )}
                >
                  <HugeiconsIcon
                    icon={ArrowUp02Icon}
                    className="size-[18px]"
                    strokeWidth={2.2}
                  />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// A person or an agent to put in a new chat.
function Pick({
  id,
  note,
  picked,
  onToggle,
}: {
  id: string
  note?: string
  picked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={picked}
      className={cn(
        PRESS,
        FOCUS,
        "flex h-9 cursor-pointer items-center gap-2 rounded-full border pr-3 pl-1.5 text-[13px] active:scale-[0.97]",
        picked
          ? "border-foreground/25 bg-foreground/[0.07] text-foreground"
          : "border-border text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
      )}
    >
      <Face id={id} size={24} still />
      <span className="font-medium">{nameOf(id)}</span>
      {note && (
        <span className="text-[12px] text-muted-foreground">{note}</span>
      )}
      {picked && (
        <HugeiconsIcon
          icon={Tick02Icon}
          className="fade-in-0 zoom-in-90 size-3.5 animate-in duration-150 motion-reduce:animate-none"
          strokeWidth={2.5}
        />
      )}
    </button>
  )
}

// Starting a chat: who is in it, what it is called, and a first message if
// there is one. Its face fills in as agents and people are picked.
function NewChat({
  onStart,
}: {
  onStart: (input: {
    name: string
    agentIds: string[]
    people: string[]
    text: string
  }) => void
}) {
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id]
  const ready = agentIds.length + people.length > 0
  const direct = agentIds.length === 1 && people.length === 0
  const agentNames = LIST.format(agentIds.map(nameOf))
  const start = () => {
    if (!ready) return
    onStart({ name: name.trim(), agentIds, people, text: text.trim() })
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto my-auto w-full max-w-xl px-6 py-10">
        <div className="flex items-center gap-4">
          <ChatAvatar agentIds={agentIds} people={people} size={64} grow />
          <div className="min-w-0 flex-1">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              // Left empty, the chat is called by who is in it.
              placeholder={membersName(agentIds, people) || "New chat"}
              aria-label="Chat name"
              className="w-full truncate bg-transparent font-semibold text-[22px] tracking-[-0.01em] outline-none placeholder:text-muted-foreground/70"
            />
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {!ready
                ? "Pick who is in it. You can change that later."
                : direct
                  ? `Just you and ${agentNames}. It reads every message.`
                  : agentIds.length > 0
                    ? `${agentNames} ${agentIds.length > 1 ? "read" : "reads"} along and ${agentIds.length > 1 ? "answer" : "answers"} when mentioned.`
                    : "No agent in it yet. You can add one later."}
            </p>
          </div>
        </div>

        <div className="mt-7 space-y-4">
          <div>
            <div className="pb-2 font-medium text-[12px] text-muted-foreground">
              Agents
            </div>
            <div className="flex flex-wrap gap-2">
              {AGENTS.map((agent) => (
                <Pick
                  key={agent.id}
                  id={agent.id}
                  note={agent.role}
                  picked={agentIds.includes(agent.id)}
                  onToggle={() => setAgentIds((list) => toggle(list, agent.id))}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="pb-2 font-medium text-[12px] text-muted-foreground">
              People
            </div>
            <div className="flex flex-wrap gap-2">
              {PEOPLE.filter((person) => person.id !== YOU).map((person) => (
                <Pick
                  key={person.id}
                  id={person.id}
                  picked={people.includes(person.id)}
                  onToggle={() => setPeople((list) => toggle(list, person.id))}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-7 rounded-2xl border border-border bg-background/40 transition-colors duration-150 focus-within:border-foreground/25">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                start()
              }
            }}
            rows={2}
            placeholder="Say what it's for, or start it empty"
            className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[14px] outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-end px-2 pb-2">
            <button
              type="button"
              onClick={start}
              disabled={!ready}
              className={cn(
                "h-8 rounded-full px-3.5 font-medium text-[13px] transition-[transform,background-color,color] duration-150 ease-out",
                ready
                  ? "cursor-pointer bg-primary text-primary-foreground active:scale-[0.97]"
                  : "bg-foreground/[0.07] text-muted-foreground"
              )}
            >
              Start chat
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PanelSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="font-medium text-[12px] text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

const PANEL_ROW =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left"

// A dashed row that opens the agents or people not in the chat yet.
function Adder({
  label,
  ids,
  onAdd,
}: {
  label: string
  ids: string[]
  onAdd: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (ids.length === 0) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          PANEL_ROW,
          PRESS,
          FOCUS,
          "group cursor-pointer text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground aria-expanded:text-foreground"
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center">
          <span className="flex size-6 items-center justify-center rounded-full border border-muted-foreground/40 border-dashed transition-colors duration-150 group-hover:border-foreground/60">
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="size-3"
              strokeWidth={2}
            />
          </span>
        </span>
        <span className="text-[13px]">{label}</span>
      </button>
      {open && (
        <div className="fade-in-0 animate-in rounded-lg bg-foreground/[0.04] p-1 duration-150 motion-reduce:animate-none">
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onAdd(id)}
              className={cn(
                PANEL_ROW,
                PRESS,
                FOCUS,
                "cursor-pointer hover:bg-foreground/[0.06]"
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center">
                <Face id={id} size={22} still />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {nameOf(id)}
                {agentById(id)?.role && (
                  <span className="pl-1.5 text-[12px] text-muted-foreground">
                    {agentById(id)?.role}
                  </span>
                )}
              </span>
              <span className="text-[12px] text-muted-foreground">Add</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function PanelHeader({
  title,
  onBack,
  onClose,
}: {
  title: string
  onBack?: () => void
  onClose: () => void
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-1 border-border/60 border-b pr-3 pl-4">
      {onBack && (
        <IconButton
          icon={ArrowLeft01Icon}
          label="Back"
          onClick={onBack}
          className="-ml-2 size-7"
        />
      )}
      <span className="flex-1 font-medium text-[13px]">{title}</span>
      <IconButton
        icon={Cancel01Icon}
        label="Close"
        onClick={onClose}
        className="size-7"
      />
    </div>
  )
}

// The chat's right panel: its name, the agents and people in it, and the
// work going on. An agent's row opens that agent.
function Details({
  chat,
  onChange,
  onAgent,
  onSession,
  onClose,
}: {
  chat: Chat
  onChange: (change: Partial<Chat>) => void
  onAgent: (id: string) => void
  onSession: (id: string) => void
  onClose: () => void
}) {
  const working = chat.working ?? []
  return (
    <>
      <PanelHeader title="Details" onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <PanelSection title="Name">
          <input
            value={chat.name}
            onChange={(event) => onChange({ name: event.target.value })}
            aria-label="Chat name"
            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-[13px] outline-none transition-colors duration-150 focus:border-foreground/25"
          />
        </PanelSection>
        {chat.place !== "lor" && (
          <PanelSection title="Lives in">
            <div className={cn(PANEL_ROW, "text-[13px]")}>
              <span className="flex size-7 shrink-0 items-center justify-center">
                <PlaceMark place={chat.place} className="size-4" />
              </span>
              <span className="flex-1 truncate">
                {chat.origin} on {PLACE_NAME[chat.place]}
              </span>
            </div>
          </PanelSection>
        )}
        <PanelSection
          title={
            chat.agentIds.length > 0
              ? `Agents · ${chat.agentIds.length}`
              : "Agents"
          }
        >
          {chat.agentIds.map((id) => {
            const agent = agentById(id)
            const busy = working.includes(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => onAgent(id)}
                className={cn(
                  PANEL_ROW,
                  PRESS,
                  FOCUS,
                  "cursor-pointer hover:bg-foreground/[0.04]"
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center">
                  <Face
                    id={id}
                    size={26}
                    state={busy ? "working" : "idle"}
                    still={!busy}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[13px]">
                    {agent?.name}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {agent?.role}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-[11px]",
                    busy ? "text-agent" : "text-muted-foreground"
                  )}
                >
                  {busy ? "Working" : "Here"}
                </span>
              </button>
            )
          })}
          <Adder
            label="Add agent"
            ids={AGENTS.map((agent) => agent.id).filter(
              (id) => !chat.agentIds.includes(id)
            )}
            onAdd={(id) => onChange({ agentIds: [...chat.agentIds, id] })}
          />
        </PanelSection>
        <PanelSection title={`People · ${chat.people.length}`}>
          {chat.people.map((id) => (
            <div key={id} className={cn(PANEL_ROW, "text-[13px]")}>
              <span className="flex size-7 shrink-0 items-center justify-center">
                <Avatar id={id} size={24} />
              </span>
              <span className="flex-1 truncate">{nameOf(id)}</span>
              {id === YOU && (
                <span className="text-[11px] text-muted-foreground">You</span>
              )}
            </div>
          ))}
          <Adder
            label="Add people"
            ids={PEOPLE.map((person) => person.id).filter(
              (id) => !chat.people.includes(id)
            )}
            onAdd={(id) => onChange({ people: [...chat.people, id] })}
          />
        </PanelSection>
        {chat.sessions.length > 0 && (
          <PanelSection title={`Sessions · ${chat.sessions.length}`}>
            {chat.sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSession(session.id)}
                className={cn(
                  PANEL_ROW,
                  PRESS,
                  FOCUS,
                  "cursor-pointer hover:bg-foreground/[0.04]"
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-agent/10 text-agent">
                  <HugeiconsIcon
                    icon={SourceCodeIcon}
                    className="size-3.5"
                    strokeWidth={2}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[13px]">
                    {session.title}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {session.repo} · {session.branch}
                  </span>
                </span>
                <SessionMark session={session} />
              </button>
            ))}
          </PanelSection>
        )}
      </div>
    </>
  )
}

// One agent, from any chat it is in: where it is, where it reports, what it
// does on a schedule and what it did on its own.
// What two agents said to each other. People read it and don't write in
// it: it is one question and its answer, and then it is over.
function ExchangePanel({
  exchange,
  onBack,
  onClose,
}: {
  exchange: Exchange
  onBack: () => void
  onClose: () => void
}) {
  const from = CHATS.find((item) => item.id === exchange.chatId)
  return (
    <>
      <PanelHeader
        title={`${nameOf(exchange.from)} and ${nameOf(exchange.to)}`}
        onBack={onBack}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {from && (
          <p className="text-[12px] text-muted-foreground">
            {nameOf(exchange.from)} asked while answering in {from.name}.
          </p>
        )}
        {exchange.messages.map((message) => (
          <div key={message.id} className="flex gap-2.5">
            <Face id={message.from} size={26} still />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-[13px]">
                  {nameOf(message.from)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {message.time}
                </span>
              </div>
              <p className="text-pretty text-[13px] text-foreground/90 leading-relaxed">
                {message.text}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-border/60 border-t px-4 py-3 text-[12px] text-muted-foreground">
        <HugeiconsIcon
          icon={LockIcon}
          className="size-3.5 shrink-0"
          strokeWidth={2}
        />
        Read-only. One question, one answer, then it ends.
      </div>
    </>
  )
}

function AgentDetails({
  agent,
  onBack,
  onRemove,
  onExchange,
  onClose,
}: {
  agent: Agent
  onBack: () => void
  onRemove: () => void
  onExchange: (id: string) => void
  onClose: () => void
}) {
  const exchanges = EXCHANGES.filter(
    (item) => item.from === agent.id || item.to === agent.id
  )
  return (
    <>
      <PanelHeader title="Agent" onBack={onBack} onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <div className="flex items-center gap-3">
          <AgentFace creature={agent.creature} size={44} state="idle" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[15px]">{agent.name}</div>
            <div className="text-[12px] text-muted-foreground">
              {agent.role}
            </div>
          </div>
        </div>
        <PanelSection title="Where it is">
          <div className="divide-y divide-border rounded-xl bg-foreground/[0.04] px-3">
            {agent.places.map((place) => {
              const home =
                place.place === agent.home.place &&
                place.name === agent.home.name
              return (
                <div
                  key={`${place.place}-${place.name}`}
                  className="flex items-center gap-2 py-2 text-[13px]"
                >
                  <PlaceMark place={place.place} />
                  <span className="flex-1 truncate">{place.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {home ? "Reports here by default" : PLACE_NAME[place.place]}
                  </span>
                </div>
              )
            })}
          </div>
        </PanelSection>
        <PanelSection title="Loops">
          {agent.loops.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">None yet.</p>
          ) : (
            <div className="divide-y divide-border rounded-xl bg-foreground/[0.04] px-3">
              {agent.loops.map((loop) => (
                <div key={loop.name} className="flex gap-2.5 py-2">
                  <HugeiconsIcon
                    icon={Infinity01Icon}
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    strokeWidth={2}
                  />
                  <div className="min-w-0 text-[13px]">
                    <div className="font-medium">{loop.name}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {loop.when} · posts to {loop.postsTo}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelSection>
        {exchanges.length > 0 && (
          <PanelSection title="With other agents">
            {exchanges.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onExchange(item.id)}
                className={cn(
                  PANEL_ROW,
                  PRESS,
                  FOCUS,
                  "cursor-pointer text-[13px] hover:bg-foreground/[0.04]"
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center">
                  <Face
                    id={item.from === agent.id ? item.to : item.from}
                    size={22}
                    still
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {item.from === agent.id
                    ? `Asked ${nameOf(item.to)}`
                    : `Asked by ${nameOf(item.from)}`}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {item.messages[0]?.time}
                </span>
              </button>
            ))}
          </PanelSection>
        )}
        <PanelSection title="On its own today">
          <div className="space-y-2">
            {agent.onItsOwn.map((item) => (
              <div key={item.when} className="flex gap-2.5 text-[13px]">
                <span className="w-10 shrink-0 text-muted-foreground tabular-nums">
                  {item.when}
                </span>
                <span className="text-foreground/90">{item.text}</span>
              </div>
            ))}
          </div>
        </PanelSection>
        <button
          type="button"
          onClick={onRemove}
          className={cn(
            PRESS,
            FOCUS,
            "h-8 cursor-pointer self-start rounded-md border border-border px-3 text-[13px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
          )}
        >
          Remove from this chat
        </button>
      </div>
    </>
  )
}

// A code session, opened from under its chat. The real one has the diff,
// browser and terminal; this shows only where it sits and how you get back.
function SessionView({
  chat,
  session,
  onBack,
}: {
  // None for a session of your own.
  chat: Chat | null
  session: Session
  onBack: () => void
}) {
  const running = session.state === "running"
  // The message that asked for it: the one before the agent's card.
  const at =
    chat?.messages.findIndex((item) => item.session === session.id) ?? -1
  const asked = at > 0 ? chat?.messages[at - 1] : undefined
  const worker = session.agentId
    ? nameOf(session.agentId)
    : (session.harness ?? "Claude Code")
  const added = session.files.reduce((sum, file) => sum + file.added, 0)
  const removed = session.files.reduce((sum, file) => sum + file.removed, 0)
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-border/60 border-b pr-4 pl-3">
        {/* A chat's session keeps the way back to its chat. */}
        {chat && (
          <>
            <button
              type="button"
              onClick={onBack}
              title={`Back to ${chat.name}`}
              className={cn(
                PRESS,
                FOCUS,
                "flex min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-lg py-1 pr-2.5 pl-1.5 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              )}
            >
              <ChatAvatar
                agentIds={chat.agentIds}
                people={chat.people}
                size={26}
              />
              <span className="truncate text-[14px]">{chat.name}</span>
            </button>
            <span className="text-muted-foreground/60">/</span>
          </>
        )}
        <span className="min-w-0 truncate pl-1.5 font-semibold text-[15px]">
          {session.title}
        </span>
        <span className="ml-1 flex shrink-0 items-center gap-1 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[12px] text-muted-foreground">
          <HugeiconsIcon
            icon={GitBranchIcon}
            className="size-3"
            strokeWidth={2}
          />
          {session.repo} · {session.branch}
        </span>
        <span className="flex-1" />
        <SessionMark session={session} />
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
            <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
              {asked && (
                <div className="flex gap-3">
                  <Face id={asked.from} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-sm">
                        {nameOf(asked.from)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        in {chat?.name} · {asked.time}
                      </span>
                    </div>
                    <p className="text-pretty text-[14px] text-foreground/90 leading-relaxed">
                      {asked.text}
                    </p>
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                {session.agentId ? (
                  <Face
                    id={session.agentId}
                    size={32}
                    state={running ? "working" : "idle"}
                  />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] text-muted-foreground">
                    <HugeiconsIcon
                      icon={SourceCodeIcon}
                      className="size-4"
                      strokeWidth={2}
                    />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm">{worker}</div>
                  <ul className="mt-1.5 space-y-1.5">
                    {session.steps.map((step, index) => {
                      const now = running && index === session.steps.length - 1
                      return (
                        <li
                          key={step}
                          className={cn(
                            "flex items-start gap-2 text-[14px] leading-snug",
                            now ? "text-agent" : "text-foreground/85"
                          )}
                        >
                          <span className="mt-[3px] flex size-3.5 shrink-0 items-center justify-center">
                            {now ? (
                              <span className="size-1.5 animate-pulse rounded-full bg-agent motion-reduce:animate-none" />
                            ) : (
                              <HugeiconsIcon
                                icon={Tick02Icon}
                                className="size-3.5 text-muted-foreground"
                                strokeWidth={2.2}
                              />
                            )}
                          </span>
                          {step}
                        </li>
                      )
                    })}
                  </ul>
                  {!running && (
                    <p className="mt-3 text-pretty text-[14px] text-foreground/90 leading-relaxed">
                      {session.summary}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="shrink-0 px-5 pb-5">
            <div className="mx-auto flex min-h-11 w-full max-w-xl items-center rounded-2xl border border-border bg-background/40 px-4 text-[14px] text-muted-foreground">
              Message {worker} in this session
            </div>
          </div>
        </div>
        <aside className="flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-border/60 border-l p-4">
          <div className="flex items-baseline gap-2 font-medium text-[12px] text-muted-foreground">
            <span className="flex-1">Changes · {session.files.length}</span>
            <span className="text-success tabular-nums">+{added}</span>
            <span className="text-destructive tabular-nums">−{removed}</span>
          </div>
          <div className="divide-y divide-border rounded-xl bg-foreground/[0.04] px-3">
            {session.files.map((file) => (
              <div
                key={file.path}
                className="flex items-baseline gap-2 py-2 text-[12px]"
              >
                <span
                  className="min-w-0 flex-1 truncate font-mono text-foreground/85"
                  title={file.path}
                >
                  {file.path.split("/").at(-1)}
                </span>
                <span className="text-success tabular-nums">+{file.added}</span>
                <span className="text-destructive tabular-nums">
                  −{file.removed}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

const CHECK_IN_REPLY =
  "Saw this when I checked in. I'll look into it and answer here."
const REPLY = "Got it. I'll take that from here and report back in this chat."

export function ChatsPrototype() {
  const [chats, setChats] = useState(CHATS)
  const [view, setView] = useState<View>({ kind: "chat", id: "safari" })
  const [panel, setPanel] = useState<Panel>(null)
  const chat = view.kind === "chat" ? chats.find((c) => c.id === view.id) : null
  const [own, setOwn] = useState(OWN_SESSIONS)
  const sessionChat =
    view.kind === "session"
      ? (chats.find((c) => c.id === view.chatId) ?? null)
      : null
  const session =
    view.kind === "session"
      ? (sessionChat?.sessions ?? own).find((item) => item.id === view.id)
      : null
  const panelAgent = panel?.kind === "agent" ? agentById(panel.id) : undefined
  const panelExchange =
    panel?.kind === "exchange"
      ? EXCHANGES.find((item) => item.id === panel.id)
      : undefined

  const patch = (chatId: string, change: (chat: Chat) => Chat) =>
    setChats((list) =>
      list.map((item) => (item.id === chatId ? change(item) : item))
    )
  // A new message puts its chat at the top of Recent. A pinned chat keeps
  // its place.
  const add = (chatId: string, message: Omit<Message, "id" | "time">) =>
    setChats((list) => {
      const target = list.find((item) => item.id === chatId)
      if (!target) return list
      const next = {
        ...target,
        when: "now",
        messages: [
          ...target.messages,
          { ...message, id: crypto.randomUUID(), time: "now" },
        ],
      }
      return target.pinned
        ? list.map((item) => (item.id === chatId ? next : item))
        : [next, ...list.filter((item) => item.id !== chatId)]
    })
  // The agents named on a message answer it. Alone with one agent, it
  // answers every message.
  const send = (target: Chat, text: string) => {
    add(target.id, { from: YOU, text })
    const lower = text.toLowerCase()
    const named = target.agentIds.filter((id) =>
      lower.includes(`@${nameOf(id).toLowerCase()}`)
    )
    const answering =
      named.length > 0 ? named : isDirect(target) ? target.agentIds : []
    if (answering.length === 0) {
      // Nobody named: the message waits in the agents' inboxes, and one it
      // seems meant for answers at its next check-in. That is every 15
      // minutes in the app; a few seconds and "a question" stand in here.
      const reader = target.agentIds[0]
      if (!reader || !text.trim().endsWith("?")) return
      setTimeout(
        () =>
          patch(target.id, (item) => ({
            ...item,
            working: [...new Set([...(item.working ?? []), reader])],
          })),
        4500
      )
      setTimeout(() => {
        add(target.id, { from: reader, text: CHECK_IN_REPLY })
        patch(target.id, (item) => ({
          ...item,
          working: (item.working ?? []).filter((other) => other !== reader),
        }))
      }, 6500)
      return
    }
    patch(target.id, (item) => ({
      ...item,
      working: [...new Set([...(item.working ?? []), ...answering])],
    }))
    answering.forEach((id, index) => {
      setTimeout(
        () => {
          add(target.id, { from: id, text: REPLY })
          patch(target.id, (item) => ({
            ...item,
            working: (item.working ?? []).filter((other) => other !== id),
          }))
        },
        1600 + index * 900
      )
    })
  }
  const open = (next: View) => {
    setView(next)
    // The panel stays open from chat to chat, on who is in the new one.
    setPanel((shown) =>
      shown && next.kind === "chat" ? { kind: "details" } : null
    )
    if (next.kind !== "chat") return
    patch(next.id, (item) => ({ ...item, unread: false }))
  }
  // A chat that gets pinned goes under the ones pinned before it.
  const pin = (id: string) =>
    setChats((list) => {
      const target = list.find((item) => item.id === id)
      if (!target) return list
      if (target.pinned) {
        return list.map((item) =>
          item.id === id ? { ...item, pinned: false } : item
        )
      }
      const rest = list.filter((item) => item.id !== id)
      const after = rest.reduce(
        (at, item, index) => (item.pinned ? index + 1 : at),
        0
      )
      return [
        ...rest.slice(0, after),
        { ...target, pinned: true },
        ...rest.slice(after),
      ]
    })

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-sidebar text-foreground">
      <Sidebar
        chats={chats}
        view={view}
        onView={open}
        onPin={pin}
        own={own}
        onNewSession={() => {
          const made: Session = {
            id: crypto.randomUUID(),
            title: "New session",
            harness: "Claude Code",
            repo: "web",
            branch: "main",
            state: "done",
            summary: "Nothing asked yet.",
            when: "now",
            steps: [],
            files: [],
          }
          setOwn((list) => [made, ...list])
          open({ kind: "session", chatId: null, id: made.id })
        }}
        onArchive={(chatId, id) => {
          if (chatId) {
            patch(chatId, (item) => ({
              ...item,
              sessions: item.sessions.filter((other) => other.id !== id),
            }))
          } else {
            setOwn((list) => list.filter((other) => other.id !== id))
          }
          // Archiving the session you're in leaves it for its chat.
          if (view.kind === "session" && view.id === id) {
            open(chatId ? { kind: "chat", id: chatId } : { kind: "new" })
          }
        }}
      />
      <main className="my-2 mr-2 flex min-w-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-background">
        {session ? (
          <SessionView
            key={session.id}
            chat={sessionChat}
            session={session}
            onBack={() =>
              sessionChat && open({ kind: "chat", id: sessionChat.id })
            }
          />
        ) : chat ? (
          <ChatView
            key={chat.id}
            chat={chat}
            detailsOpen={panel !== null}
            onDetails={() =>
              setPanel((shown) => (shown ? null : { kind: "details" }))
            }
            onPin={() => pin(chat.id)}
            onSend={(text) => send(chat, text)}
            onSession={(id) => open({ kind: "session", chatId: chat.id, id })}
            onExchange={(id) => setPanel({ kind: "exchange", id })}
          />
        ) : (
          <NewChat
            onStart={({ name, agentIds, people, text }) => {
              const made: Chat = {
                id: crypto.randomUUID(),
                name: name || membersName(agentIds, people),
                agentIds,
                people: [YOU, ...people],
                place: "lor",
                when: "now",
                sessions: [],
                messages: [],
              }
              setChats((list) => [made, ...list])
              setView({ kind: "chat", id: made.id })
              // With one agent in a new chat, the first message is for it.
              if (text) {
                setTimeout(
                  () =>
                    send(
                      agentIds.length === 1 ? { ...made, people: [YOU] } : made,
                      text
                    ),
                  0
                )
              }
            }}
          />
        )}
        {chat && panel && (
          <aside className="fade-in-0 slide-in-from-right-2 flex w-[300px] shrink-0 animate-in flex-col border-border/60 border-l duration-200 motion-reduce:animate-none">
            {panelExchange ? (
              <ExchangePanel
                key={panelExchange.id}
                exchange={panelExchange}
                onBack={() => setPanel({ kind: "details" })}
                onClose={() => setPanel(null)}
              />
            ) : panelAgent ? (
              <AgentDetails
                key={panelAgent.id}
                agent={panelAgent}
                onExchange={(id) => setPanel({ kind: "exchange", id })}
                onBack={() => setPanel({ kind: "details" })}
                onRemove={() => {
                  patch(chat.id, (item) => ({
                    ...item,
                    agentIds: item.agentIds.filter(
                      (id) => id !== panelAgent.id
                    ),
                  }))
                  setPanel({ kind: "details" })
                }}
                onClose={() => setPanel(null)}
              />
            ) : (
              <Details
                key={chat.id}
                chat={chat}
                onChange={(change) =>
                  patch(chat.id, (item) => ({ ...item, ...change }))
                }
                onAgent={(id) => setPanel({ kind: "agent", id })}
                onSession={(id) =>
                  open({ kind: "session", chatId: chat.id, id })
                }
                onClose={() => setPanel(null)}
              />
            )}
          </aside>
        )}
      </main>
    </div>
  )
}
