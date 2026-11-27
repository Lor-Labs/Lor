import {
  Clock01Icon,
  LeftToRightListBulletIcon,
  SourceCodeIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { cn } from "@repo/ui/lib/utils"
import { type KeyboardEvent, useState } from "react"
import { me } from "../prototype-data"
import { PersonAvatar } from "../prototype-parts"
import { CARD } from "./agent-blocks"
import { AgentSettings } from "./agent-settings"
import {
  type Agent,
  agents,
  type Chat,
  channelById,
  starterLine,
  type Work,
} from "./agents-data"
import {
  AgentAvatar,
  PRESS,
  Segmented,
  SendButton,
  StateIcon,
} from "./agents-parts"
import { type AgentTab, useProto } from "./agents-store"

const BOX =
  "rounded-[22px] border border-input bg-background shadow-sm transition-colors duration-150 focus-within:border-muted-foreground/50 dark:bg-foreground/[0.04]"
const BOX_TEXT =
  "field-sizing-content block max-h-48 min-h-[60px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"

// The main way to talk to an agent. It starts a chat, which has no repo or
// mode: the agent decides what to start under it.
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
  const { startCode, openNewCode, openNew } = useProto()
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
          Straight to a coding agent in one repo, with no agent above it.
        </p>
        {withRepos.length > 1 && (
          <div className="mb-4 flex justify-center gap-1.5">
            {withRepos.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openNewCode(item.id)}
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
              On your own plan
            </span>
            <SendButton enabled={canSend} onClick={submit} />
          </div>
        </div>
        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          Not sure which repo, or more than one?{" "}
          <button
            type="button"
            onClick={() => openNew(agent.id)}
            className="cursor-pointer font-medium text-foreground hover:underline"
          >
            Start a chat with {agent.name}
          </button>{" "}
          and it starts what the work needs.
        </p>
      </div>
    </div>
  )
}

// A new chat: pick the agent, say what you need. No channel involved.
export function NewChat({ agentId }: { agentId: string }) {
  const { configured, openNew } = useProto()
  const ready = agents.filter((item) => configured[item.id])
  const agent = ready.find((item) => item.id === agentId) ?? ready[0]
  if (!agent) return null
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center px-6 pb-24">
      <div className="w-full max-w-[640px]">
        <div className="mb-5 flex justify-center">
          <AgentAvatar agent={agent} size={56} />
        </div>
        <h1 className="text-center text-[22px] font-semibold tracking-tight">
          New chat with {agent.name}
        </h1>
        <p className="mt-1.5 mb-5 text-center text-[14px] text-muted-foreground">
          {agent.job}
        </p>
        <div className="mb-4 flex justify-center gap-1.5">
          {ready.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openNew(item.id)}
              aria-pressed={item.id === agent.id}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-full border py-1 pr-3 pl-1.5 text-[13px]",
                PRESS,
                item.id === agent.id
                  ? "border-foreground/30 bg-foreground/[0.06] font-medium"
                  : "border-border/80 text-muted-foreground hover:text-foreground"
              )}
            >
              <AgentAvatar agent={item} size={20} />
              {item.name}
              <span className="font-normal text-muted-foreground">
                {item.role}
              </span>
            </button>
          ))}
        </div>
        <AskBox key={agent.id} agent={agent} />
        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          Only you are in it to start. Anyone who can see {agent.name} can open
          it, and mentioning a teammate adds them.
        </p>
      </div>
    </div>
  )
}

// An agent's page: everyone's chats with it, and its own settings.
export function AgentPage({ agent, tab }: { agent: Agent; tab: AgentTab }) {
  const { configured, channelAgents, openAgent, openCanvas } = useProto()
  const setUp = configured[agent.id]
  const inChannels = Object.entries(channelAgents)
    .filter(([, agentId]) => agentId === agent.id)
    .map(([channelId]) => `#${channelById(channelId)?.name}`)
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 px-5">
        <AgentAvatar agent={agent} status={setUp ? "idle" : "off"} size={32} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-5">
            {agent.name}
            <span className="ml-2 font-normal text-muted-foreground">
              {agent.role}
            </span>
          </div>
          <div className="truncate text-[12.5px] leading-4 text-muted-foreground">
            {!setUp
              ? "Not set up yet"
              : inChannels.length > 0
                ? `In ${inChannels.join(", ")}`
                : "In no channel. Chat with it directly."}
          </div>
        </div>
        <Segmented
          id="agent-tab"
          className="w-[210px]"
          value={tab}
          onChange={(next) => openAgent(agent.id, next)}
          items={[
            { id: "chats", label: "Chats" },
            { id: "settings", label: "Settings" },
          ]}
        />
        <button
          type="button"
          onClick={() => openCanvas({ kind: "log", agentId: agent.id })}
          aria-label="Activity"
          title="Activity"
          className={cn(
            "flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
            PRESS
          )}
        >
          <HugeiconsIcon
            icon={LeftToRightListBulletIcon}
            className="size-[18px]"
            strokeWidth={1.8}
          />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        {tab === "chats" ? (
          <ChatsTab agent={agent} />
        ) : (
          <AgentSettings agent={agent} />
        )}
      </div>
    </div>
  )
}

function ChatsTab({ agent }: { agent: Agent }) {
  const { configured, chats, openChat, ask, openAgent } = useProto()
  const setUp = configured[agent.id]
  const setupChat = chats.find((chat) => chat.agentId === agent.id)
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
                setupChat
                  ? openChat(setupChat.id)
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
                  onClick={() => openAgent(agent.id, "settings")}
                  title={`Last fired ${watch.lastFired}`}
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
                    · reports in #{channelById(watch.reportsIn)?.name}
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

// Every chat with this agent, everyone's: quiet, not hidden. A chat lists
// the code sessions it started under it. A code session someone started
// directly stands on its own.
function WorkList({ agent }: { agent: Agent }) {
  const { chats, works, stateOf, childrenOf, openChat, openWork } = useProto()
  const withAgent = chats
    .filter((chat) => chat.agentId === agent.id)
    .map((chat) => ({
      key: chat.id,
      state: stateOf(chat.id),
      node: (
        <ChatRow
          chat={chat}
          kids={childrenOf(chat.id)}
          onOpen={() => openChat(chat.id)}
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
  const rows = [...code, ...withAgent].sort(
    (a, b) => ORDER[a.state] - ORDER[b.state]
  )

  return (
    <section>
      <h3 className="mb-2 flex items-baseline gap-2 text-[12.5px] font-medium text-muted-foreground">
        Chats with {agent.name}
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
  chat,
  kids,
  onOpen,
  onOpenWork,
}: {
  chat: Chat
  kids: Work[]
  onOpen: () => void
  onOpenWork: (workId: string) => void
}) {
  const { stateOf } = useProto()
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
        <StateIcon state={stateOf(chat.id)} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium leading-5">
            {chat.title}
          </span>
          <span className="block truncate text-[12.5px] leading-5 text-muted-foreground">
            {starterLine(chat.starter)}
          </span>
        </span>
        <span className="hidden -space-x-1.5 sm:flex">
          {chat.people.map((person) => (
            <PersonAvatar
              key={person.id}
              person={person}
              className="size-5 ring-2 ring-background"
            />
          ))}
        </span>
        <span className="w-9 shrink-0 text-right text-[12px] text-muted-foreground">
          {chat.time}
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
  const first = work.asker.name.split(" ")[0]
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
            Code session · {work.asker.id === me.id ? "you" : first} started it
            · {workLine(work).toLowerCase()}
          </span>
        </span>
        <PersonAvatar person={work.asker} className="size-5" />
        <span className="w-9 shrink-0" />
      </button>
    </div>
  )
}
