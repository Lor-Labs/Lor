import {
  ArrowRight01Icon,
  ArrowUp02Icon,
  ArrowUpRight01Icon,
  BubbleChatIcon,
  Clock01Icon,
  DiscordIcon,
  LeftToRightListBulletIcon,
  Settings01Icon,
  SlackIcon,
  SourceCodeIcon,
  Tick02Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { motion } from "motion/react"
import { type KeyboardEvent, type ReactNode, useState } from "react"
import { me } from "../prototype-data"
import { MentionText, PersonAvatar } from "../prototype-parts"
import { CARD } from "./agent-blocks"
import {
  type Agent,
  agents,
  pickups,
  type Room,
  roomLevels,
  roomName,
  starterLine,
  type Thread,
  trustLevels,
  type Work,
} from "./agents-data"
import {
  AgentAvatar,
  LorMark,
  PRESS,
  RoomIcon,
  Segmented,
  StateIcon,
} from "./agents-parts"
import { type AgentTab, useProto } from "./agents-store"

const enter = {
  initial: { opacity: 0, transform: "translateY(8px)" },
  animate: { opacity: 1, transform: "translateY(0px)" },
  transition: { duration: 0.24, ease: EASE_OUT },
}

const SEND =
  "flex size-8 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 ease-out"

function SendButton({
  enabled,
  onClick,
}: {
  enabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label="Send"
      className={cn(
        SEND,
        enabled
          ? "cursor-pointer bg-foreground text-background active:scale-[0.94]"
          : "bg-foreground/[0.07] text-muted-foreground"
      )}
    >
      <HugeiconsIcon
        icon={ArrowUp02Icon}
        className="size-[18px]"
        strokeWidth={2.2}
      />
    </button>
  )
}

const BOX =
  "rounded-[22px] border border-input bg-background shadow-sm transition-colors duration-150 focus-within:border-muted-foreground/50 dark:bg-foreground/[0.04]"
const BOX_TEXT =
  "field-sizing-content block max-h-48 min-h-[60px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"

// The main way to talk to a channel's agent. It starts a thread, which has
// no repo or mode: the agent decides what to start under it.
export function AskBox({ agent }: { agent: Agent }) {
  const { ask } = useProto()
  const [text, setText] = useState("")
  const canSend = text.trim().length > 0

  const submit = (value: string) => {
    if (!value.trim()) return
    ask(agent.id, value.trim())
    setText("")
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit(text)
    }
  }

  return (
    <div>
      <div className={BOX}>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={`Ask ${agent.name} to do something`}
          className={BOX_TEXT}
        />
        <div className="flex items-center gap-2 px-2.5 pb-2.5 pl-4">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
            {agent.repos.length > 0
              ? `${agent.name} picks the repos and starts the code sessions it needs`
              : `${agent.name} works on its own computer`}
          </span>
          <SendButton enabled={canSend} onClick={() => submit(text)} />
        </div>
      </div>
      {!canSend && agent.suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => submit(suggestion)}
              className={cn(
                "cursor-pointer rounded-full border border-border/80 px-3 py-1 text-[13px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                PRESS
              )}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// New session, as it works today: one coding agent in one repo, with no
// channel agent above it.
export function NewCodeSession({ agentId }: { agentId: string }) {
  const { startCode, openNew, openAgent } = useProto()
  const withRepos = agents.filter((item) => item.repos.length > 0)
  const agent = withRepos.find((item) => item.id === agentId) ?? withRepos[0]
  const [text, setText] = useState("")
  const [repo, setRepo] = useState(agent?.repos[0] ?? "")
  if (!agent) return null
  const canSend = text.trim().length > 0

  const submit = () => {
    if (!canSend) return
    startCode(agent.id, text.trim(), repo)
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center px-6 pb-24">
      <div className="w-full max-w-[640px]">
        <h1 className="text-center text-[22px] font-semibold tracking-tight">
          New code session
        </h1>
        <p className="mt-1.5 mb-5 text-center text-[14px] text-muted-foreground">
          Straight to a coding agent in one repo.
        </p>
        {withRepos.length > 1 && (
          <div className="mb-4 flex justify-center gap-1.5">
            {withRepos.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openNew(item.id)}
                aria-pressed={item.id === agent.id}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1 text-[13px]",
                  PRESS,
                  item.id === agent.id
                    ? "border-foreground/30 bg-foreground/[0.06] font-medium"
                    : "border-border/80 text-muted-foreground hover:text-foreground"
                )}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}
        <div className={BOX}>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
            rows={2}
            // biome-ignore lint/a11y/noAutofocus: this screen is only this box
            autoFocus
            placeholder={`Describe the change to make in ${repo}`}
            className={BOX_TEXT}
          />
          <div className="flex items-center gap-2 px-2.5 pb-2.5">
            <HugeiconsIcon
              icon={SourceCodeIcon}
              className="ml-1.5 size-4 text-muted-foreground"
              strokeWidth={2}
            />
            <div className="flex min-w-0 flex-1 gap-1">
              {agent.repos.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setRepo(name)}
                  aria-pressed={repo === name}
                  className={cn(
                    "cursor-pointer rounded-md px-2 py-1 font-mono text-[12px]",
                    PRESS,
                    repo === name
                      ? "bg-foreground/[0.08] text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
            <span className="hidden truncate text-[12.5px] text-muted-foreground sm:block">
              In {agent.name}
            </span>
            <SendButton enabled={canSend} onClick={submit} />
          </div>
        </div>
        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          Not sure which repo, or more than one?{" "}
          <button
            type="button"
            onClick={() => openAgent(agent.id)}
            className="cursor-pointer font-medium text-foreground hover:underline"
          >
            Ask {agent.name}
          </button>{" "}
          and it starts what the work needs.
        </p>
      </div>
    </div>
  )
}

function HeaderButton({
  label,
  onClick,
  icon,
}: {
  label: string
  onClick: () => void
  icon: typeof Settings01Icon
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
        PRESS
      )}
    >
      <HugeiconsIcon icon={icon} className="size-[18px]" strokeWidth={1.8} />
    </button>
  )
}

// A channel's page: the agent, what it is working on, and the room where the
// team talks.
export function AgentPage({ agent, tab }: { agent: Agent; tab: AgentTab }) {
  const { configured, rooms, openAgent, openCanvas } = useProto()
  const setUp = configured[agent.id]
  const room = rooms[agent.id]
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 px-5">
        <AgentAvatar
          agent={agent}
          status={setUp ? "idle" : "off"}
          className="size-8"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-5">
            {agent.name}
          </div>
          <div className="truncate text-[12.5px] leading-4 text-muted-foreground">
            {setUp ? agent.job : "Not set up yet"}
          </div>
        </div>
        <Segmented
          id="agent-tab"
          className="w-[230px]"
          value={tab}
          onChange={(next) => openAgent(agent.id, next)}
          items={[
            { id: "work", label: "Work" },
            {
              id: "room",
              label: (
                <>
                  {room && <RoomIcon room={room} className="size-3.5" />}
                  Team chat
                </>
              ),
            },
          ]}
        />
        <HeaderButton
          label="Activity"
          icon={LeftToRightListBulletIcon}
          onClick={() => openCanvas({ kind: "log", agentId: agent.id })}
        />
        <HeaderButton
          label="Setup"
          icon={Settings01Icon}
          onClick={() => openCanvas({ kind: "setup", agentId: agent.id })}
        />
      </header>
      <div className="min-h-0 flex-1">
        {tab === "work" ? (
          <WorkSection agent={agent} />
        ) : (
          <RoomTab agent={agent} />
        )}
      </div>
    </div>
  )
}

function WorkSection({ agent }: { agent: Agent }) {
  const { configured, threads, openThread, ask, openCanvas } = useProto()
  const setUp = configured[agent.id]
  const setupThread = threads.find((thread) => thread.agentId === agent.id)
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8 px-6 pt-8 pb-12">
        {setUp ? (
          <AskBox agent={agent} />
        ) : (
          <div className={cn(CARD, "px-5 py-5")}>
            <div className="text-[15px] font-medium">
              {agent.name} is not set up yet
            </div>
            <p className="mt-1 text-[14px] leading-6 text-muted-foreground">
              Tell it what to look after. It proposes what to watch, which tools
              to use and what needs approval, and you approve it once.
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() =>
                setupThread
                  ? openThread(setupThread.id)
                  : ask(agent.id, `Set up ${agent.name}`)
              }
            >
              Set it up
            </Button>
          </div>
        )}

        {agent.watching.length > 0 && (
          <section>
            <h3 className="mb-2 text-[12.5px] font-medium text-muted-foreground">
              Always on
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {agent.watching.map((watch) => (
                <button
                  key={watch.id}
                  type="button"
                  onClick={() =>
                    openCanvas({ kind: "setup", agentId: agent.id })
                  }
                  title={`${trustLevels[watch.level].label}. ${watch.owner.name} answers for it. Last fired ${watch.lastFired}.`}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-full border border-border/80 py-1 pr-3 pl-2.5 text-[13px] hover:bg-foreground/[0.04]",
                    PRESS
                  )}
                >
                  <HugeiconsIcon
                    icon={watch.kind === "schedule" ? Clock01Icon : ZapIcon}
                    className="size-3.5 text-muted-foreground"
                    strokeWidth={2}
                  />
                  {watch.label}
                  <span className="text-muted-foreground">
                    · {trustLevels[watch.level].label.toLowerCase()}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <WorkList agent={agent} />
      </div>
    </div>
  )
}

const ORDER = { needs_you: 0, running: 1, done: 2 } as const

function RepoTag({ name }: { name: string }) {
  return (
    <span className="shrink-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {name}
    </span>
  )
}

function workLine(work: Work) {
  if (work.state === "running") return "Running"
  if (work.state === "needs_you") return "Needs approval"
  return work.result ?? "Done"
}

// Everything in this channel, everyone's. A thread lists the code
// threads it started under it. A code session someone started directly
// stands on its own.
function WorkList({ agent }: { agent: Agent }) {
  const { threads, works, stateOf, childrenOf, openThread, openWork } =
    useProto()
  const chats = threads
    .filter((thread) => thread.agentId === agent.id)
    .map((thread) => ({
      key: thread.id,
      state: stateOf(thread.id),
      node: (
        <ChatRow
          thread={thread}
          kids={childrenOf(thread.id)}
          onOpen={() => openThread(thread.id)}
          onOpenWork={openWork}
        />
      ),
    }))
  const code = Object.values(works)
    .filter((work) => work.agentId === agent.id && !work.parentId)
    .reverse()
    .map((work) => ({
      key: work.id,
      state: work.state,
      node: <CodeRow work={work} onOpen={() => openWork(work.id)} />,
    }))
  const rows = [...code, ...chats].sort(
    (a, b) => ORDER[a.state] - ORDER[b.state]
  )

  return (
    <section>
      <h3 className="mb-2 flex items-baseline gap-2 text-[12.5px] font-medium text-muted-foreground">
        Work in {agent.name}
        <span className="font-normal text-muted-foreground/70">
          Everyone's. Yours are also in the sidebar.
        </span>
      </h3>
      {rows.length === 0 ? (
        <p className="py-6 text-[14px] text-muted-foreground">Nothing yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border/60 rounded-2xl border border-border/70">
          {rows.map((row) => (
            <div key={row.key}>{row.node}</div>
          ))}
        </div>
      )}
    </section>
  )
}

function ChatRow({
  thread,
  kids,
  onOpen,
  onOpenWork,
}: {
  thread: Thread
  kids: Work[]
  onOpen: () => void
  onOpenWork: (workId: string) => void
}) {
  const { stateOf } = useProto()
  const owner =
    thread.owner.id === me.id
      ? "you own it"
      : `${thread.owner.name.split(" ")[0]} owns it`
  return (
    <div className="px-2 py-1.5">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-foreground/[0.04]",
          PRESS
        )}
      >
        <StateIcon state={stateOf(thread.id)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium leading-5">
            {thread.title}
          </span>
          <span className="block truncate text-[12.5px] leading-5 text-muted-foreground">
            {starterLine(thread.starter)} · {owner}
          </span>
        </span>
        <span className="hidden -space-x-1.5 sm:flex">
          {thread.people.map((person) => (
            <PersonAvatar
              key={person.id}
              person={person}
              className="size-5 ring-2 ring-background"
            />
          ))}
        </span>
        <span className="w-9 shrink-0 text-right text-[12px] text-muted-foreground">
          {thread.time}
        </span>
      </button>
      {kids.length > 0 && (
        <div className="mb-1 ml-[25px] flex flex-col border-l border-border/70 pl-2">
          {kids.map((work) => (
            <button
              key={work.id}
              type="button"
              onClick={() => onOpenWork(work.id)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-foreground/[0.04]",
                PRESS
              )}
            >
              <StateIcon state={work.state} />
              <span className="min-w-0 truncate text-[13.5px]">
                {work.title}
              </span>
              {work.repo && work.repo !== work.title && (
                <RepoTag name={work.repo} />
              )}
              <span
                className={cn(
                  "ml-auto shrink-0 text-[12.5px] text-muted-foreground",
                  work.state === "running" && "shimmer"
                )}
              >
                {workLine(work)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CodeRow({ work, onOpen }: { work: Work; onOpen: () => void }) {
  const first = work.owner.name.split(" ")[0]
  return (
    <div className="px-2 py-1.5">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-foreground/[0.04]",
          PRESS
        )}
      >
        <StateIcon state={work.state} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14.5px] font-medium leading-5">
              {work.title}
            </span>
            {work.repo && <RepoTag name={work.repo} />}
          </span>
          <span className="block truncate text-[12.5px] leading-5 text-muted-foreground">
            Code session · {work.owner.id === me.id ? "you" : first} started it
            · {workLine(work).toLowerCase()}
          </span>
        </span>
        <PersonAvatar person={work.owner} className="size-5" />
        <span className="w-9 shrink-0" />
      </button>
    </div>
  )
}

function RoomTab({ agent }: { agent: Agent }) {
  const { rooms } = useProto()
  const room = rooms[agent.id]
  if (!room) return <ConnectRoom agent={agent} />
  if (room.kind === "lor") return <LorChat agent={agent} />
  return <LinkedRoom agent={agent} room={room} />
}

function Step({ index, children }: { index: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] text-[11.5px] font-semibold tabular-nums">
        {index}
      </span>
      <div className="min-w-0 flex-1 text-[14px] leading-6">{children}</div>
    </li>
  )
}

function ExternalSteps({
  agent,
  kind,
}: {
  agent: Agent
  kind: "slack" | "discord"
}) {
  const { connectRoom } = useProto()
  const app = kind === "slack" ? "Slack" : "Discord"
  const channels = [`#${agent.id}`, "#general"]
  const [added, setAdded] = useState(false)
  const [channel, setChannel] = useState(channels[0] ?? "#general")
  return (
    <motion.div {...enter} className="border-t border-border/60 px-4 py-4">
      <ol className="flex flex-col gap-3">
        <Step index={1}>
          Add Lor to your {app} {kind === "slack" ? "workspace" : "server"}.
          <div className="mt-1.5">
            {added ? (
              <span className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
                <StateIcon state="done" />
                Added to Northstar
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAdded(true)}
              >
                Add to {app}
              </Button>
            )}
          </div>
        </Step>
        <Step index={2}>
          Pick the channel where the {agent.name} team talks.
          <div className="mt-1.5 flex gap-1">
            {channels.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setChannel(name)}
                aria-pressed={channel === name}
                className={cn(
                  "cursor-pointer rounded-md px-2 py-1 text-[13px]",
                  PRESS,
                  channel === name
                    ? "bg-foreground/[0.08] font-medium"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </Step>
        <Step index={3}>
          Invite it there:{" "}
          <code className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[12.5px]">
            /invite @Lor
          </code>
        </Step>
      </ol>
      <Button
        size="sm"
        className="mt-4"
        disabled={!added}
        onClick={() => connectRoom(agent.id, { kind, channel })}
      >
        Link {channel}
      </Button>
    </motion.div>
  )
}

function RoomOption({
  icon,
  title,
  text,
  action,
  children,
}: {
  icon: typeof SlackIcon
  title: string
  text: string
  action: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-foreground/[0.06]">
          <HugeiconsIcon
            icon={icon}
            className="size-[18px]"
            strokeWidth={1.8}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium leading-5">{title}</div>
          <div className="text-[13px] leading-5 text-muted-foreground">
            {text}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

// No room yet: this tab is where a team links the chat it already uses.
function ConnectRoom({ agent }: { agent: Agent }) {
  const { connectRoom } = useProto()
  const [open, setOpen] = useState<"slack" | "discord" | null>(null)
  const toggle = (kind: "slack" | "discord") =>
    setOpen((current) => (current === kind ? null : kind))
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[640px] px-6 pt-10 pb-12">
        <h2 className="text-[20px] font-semibold tracking-tight">
          Where does the {agent.name} team talk?
        </h2>
        <p className="mt-1.5 text-[15px] leading-7 text-muted-foreground">
          {agent.name} reads that channel to keep up and answers when someone
          mentions it. Every answer is a thread, kept here too. Pick one place.
          You can switch later.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <RoomOption
            icon={SlackIcon}
            title="Slack"
            text="Link a channel your team already uses."
            action={
              <Button
                size="sm"
                variant={open === "slack" ? "ghost" : "outline"}
                onClick={() => toggle("slack")}
              >
                {open === "slack" ? "Cancel" : "Connect"}
              </Button>
            }
          >
            {open === "slack" && <ExternalSteps agent={agent} kind="slack" />}
          </RoomOption>
          <RoomOption
            icon={DiscordIcon}
            title="Discord"
            text="Link a channel in your server."
            action={
              <Button
                size="sm"
                variant={open === "discord" ? "ghost" : "outline"}
                onClick={() => toggle("discord")}
              >
                {open === "discord" ? "Cancel" : "Connect"}
              </Button>
            }
          >
            {open === "discord" && (
              <ExternalSteps agent={agent} kind="discord" />
            )}
          </RoomOption>
          <RoomOption
            icon={BubbleChatIcon}
            title="Lor chat"
            text="Talk here. Nothing to install."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => connectRoom(agent.id, { kind: "lor" })}
              >
                Turn on
              </Button>
            }
          />
        </div>
        <p className="mt-5 text-[13px] leading-6 text-muted-foreground">
          {agent.name} works without any of these. Ask it from the Work tab.
        </p>
      </div>
    </div>
  )
}

const OUTCOME = {
  thread: "text-agent",
  noted: "text-success",
  passed: "text-muted-foreground",
} as const

// A linked Slack or Discord channel. People's messages stay there; this shows
// how the agent behaves in it and what it took from it.
function LinkedRoom({
  agent,
  room,
}: {
  agent: Agent
  room: Exclude<Room, { kind: "lor" }>
}) {
  const { roomLevel, setRoomLevel, disconnectRoom, openThread } = useProto()
  const level = roomLevel[agent.id] ?? "mentioned"
  const app = room.kind === "slack" ? "Slack" : "Discord"
  const heard = pickups[agent.id] ?? []
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8 px-6 pt-8 pb-12">
        <div className={cn(CARD, "flex items-center gap-3 px-4 py-3.5")}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-foreground/[0.06]">
            <RoomIcon room={room} className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-medium leading-5">
              {roomName(room, agent)}
            </div>
            <div className="text-[13px] leading-5 text-muted-foreground">
              Linked. The team talks there and {agent.name} is in the channel.
            </div>
          </div>
          <Button size="sm" variant="outline">
            Open in {app}
            <HugeiconsIcon
              icon={ArrowUpRight01Icon}
              className="size-3.5"
              strokeWidth={2}
            />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => disconnectRoom(agent.id)}
          >
            Disconnect
          </Button>
        </div>

        <section>
          <h3 className="mb-2 text-[12.5px] font-medium text-muted-foreground">
            How {agent.name} behaves in {room.channel}
          </h3>
          <div className="flex flex-col divide-y divide-border/60 rounded-2xl border border-border/70">
            {roomLevels.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-foreground/[0.03]"
              >
                <input
                  type="radio"
                  name={`room-level-${agent.id}`}
                  checked={level === item.id}
                  onChange={() => setRoomLevel(agent.id, item.id)}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
                    level === item.id
                      ? "border-foreground"
                      : "border-muted-foreground/40"
                  )}
                >
                  {level === item.id && (
                    <span className="size-2 rounded-full bg-foreground" />
                  )}
                </span>
                <span>
                  <span className="block text-[14.5px] font-medium leading-6">
                    {item.label}
                  </span>
                  <span className="block text-[13.5px] leading-5 text-muted-foreground">
                    {item.text}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {heard.length > 0 && (
          <section>
            <h3 className="mb-2 text-[12.5px] font-medium text-muted-foreground">
              What {agent.name} took from {room.channel} today
            </h3>
            <div className="flex flex-col gap-5">
              {heard.map((item) => (
                <div key={item.id} className="flex gap-3">
                  <PersonAvatar
                    person={item.author}
                    className="mt-0.5 size-7"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[14px] font-semibold">
                        {item.author.name}
                      </span>
                      <span className="text-[12px] text-muted-foreground/80">
                        {item.time}
                      </span>
                    </div>
                    <p className="text-[15px] leading-7">
                      <MentionText text={item.text} />
                    </p>
                    <div
                      className={cn(
                        "mt-0.5 flex items-center gap-1.5 text-[13px]",
                        OUTCOME[item.outcome]
                      )}
                    >
                      <LorMark className="size-3" />
                      {item.note}
                      {item.threadId && (
                        <button
                          type="button"
                          onClick={() =>
                            item.threadId && openThread(item.threadId)
                          }
                          className="ml-1 inline-flex cursor-pointer items-center gap-0.5 font-medium hover:underline"
                        >
                          Open it
                          <HugeiconsIcon
                            icon={ArrowRight01Icon}
                            className="size-3.5"
                            strokeWidth={2}
                          />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="text-[13px] leading-6 text-muted-foreground">
          People's messages stay in {app}. Threads with {agent.name} are kept
          here, whatever happens to the link.
        </p>
      </div>
    </div>
  )
}

// Lor's own chat as the room: people talk to people, and the agent listens.
function LorChat({ agent }: { agent: Agent }) {
  const { roomChat, threads, postRoom, disconnectRoom, openThread } = useProto()
  const [text, setText] = useState("")
  const messages = roomChat[agent.id] ?? []
  const canSend = text.trim().length > 0
  const submit = () => {
    if (!canSend) return
    postRoom(agent.id, text.trim())
    setText("")
  }
  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-[720px] shrink-0 items-center gap-2 px-6 pt-2 text-[13px] text-muted-foreground">
        <HugeiconsIcon
          icon={Tick02Icon}
          className="size-3.5"
          strokeWidth={2.5}
        />
        <span className="min-w-0 flex-1 truncate">
          Lor chat is on for #{agent.id}. {agent.name} is listening.
        </span>
        <button
          type="button"
          onClick={() => disconnectRoom(agent.id)}
          className="cursor-pointer font-medium hover:text-foreground"
        >
          Use Slack or Discord instead
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-end gap-5 px-6 pt-6 pb-6">
          {messages.length === 0 && (
            <p className="py-10 text-center text-[15px] leading-7 text-muted-foreground">
              This is the start of #{agent.id}.
              <br />
              Talk to your team here. Mention @Lor to hand it something.
            </p>
          )}
          {messages.map((message) => {
            const thread = threads.find((item) => item.id === message.threadId)
            return (
              <motion.div key={message.id} {...enter} className="flex gap-3">
                <PersonAvatar
                  person={message.author}
                  className="mt-0.5 size-7"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[14px] font-semibold">
                      {message.author.name}
                    </span>
                    <span className="text-[12px] text-muted-foreground/80">
                      now
                    </span>
                  </div>
                  <p className="text-[15px] leading-7">
                    <MentionText text={message.text} />
                  </p>
                  {thread && (
                    <motion.button
                      type="button"
                      {...enter}
                      transition={{ ...enter.transition, delay: 0.3 }}
                      onClick={() => openThread(thread.id)}
                      className="mt-1.5 flex cursor-pointer items-center gap-2 rounded-xl border border-border/70 px-3 py-1.5 text-[13.5px] hover:bg-foreground/[0.04]"
                    >
                      <LorMark className="size-3.5" />
                      <span className="text-muted-foreground">
                        Lor answered in a thread
                      </span>
                      <span className="font-medium">{thread.title}</span>
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        className="size-3.5 text-muted-foreground"
                        strokeWidth={2}
                      />
                    </motion.button>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[720px] shrink-0 px-6 pb-5">
        <div className="flex items-end gap-2 rounded-[22px] border border-input bg-background py-2 pr-2 pl-4 shadow-sm transition-colors duration-150 focus-within:border-muted-foreground/50 dark:bg-foreground/[0.04]">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder={`Message #${agent.id}`}
            className="field-sizing-content block max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
          />
          <SendButton enabled={canSend} onClick={submit} />
        </div>
        <p className="mt-2 text-center text-[11.5px] text-muted-foreground/70">
          People only. Mention @Lor and it answers in a thread, not here.
        </p>
      </div>
    </div>
  )
}
