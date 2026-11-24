import {
  ArrowRight01Icon,
  ArrowUpRight01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { MentionText, PersonAvatar } from "../prototype-parts"
import {
  type Agent,
  agentById,
  agents,
  type Channel,
  type ChannelMessage,
  placeNames,
} from "./agents-data"
import {
  AgentAvatar,
  PlaceIcon,
  PRESS,
  SendButton,
  StateIcon,
} from "./agents-parts"
import { useProto } from "./agents-store"

const enter = {
  initial: { opacity: 0, transform: "translateY(8px)" },
  animate: { opacity: 1, transform: "translateY(0px)" },
  transition: { duration: 0.24, ease: EASE_OUT },
}

// The chat a message started, shown in the channel as its thread. The same
// chat is listed under the agent for the people in it.
function ChatLink({ chatId, agent }: { chatId: string; agent: Agent }) {
  const { chats, stateOf, childrenOf, openChat } = useProto()
  const chat = chats.find((item) => item.id === chatId)
  if (!chat) return null
  const sessions = childrenOf(chat.id).filter((work) => work.mode === "code")
  return (
    <motion.button
      type="button"
      {...enter}
      onClick={() => openChat(chat.id)}
      className={cn(
        "mt-1.5 flex w-full max-w-[520px] cursor-pointer items-center gap-2.5 rounded-xl border border-border/70 px-3 py-2 text-left hover:bg-foreground/[0.04]",
        PRESS
      )}
    >
      <StateIcon state={stateOf(chat.id)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium leading-5">
          {chat.title}
        </span>
        <span className="block truncate text-[12.5px] leading-4 text-muted-foreground">
          Chat with {agent.name}
          {sessions.length > 0 &&
            ` · ${sessions.length} code ${sessions.length === 1 ? "session" : "sessions"}`}
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
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        className="size-4 shrink-0 text-muted-foreground"
        strokeWidth={2}
      />
    </motion.button>
  )
}

function MessageRow({
  message,
  agent,
}: {
  message: ChannelMessage
  agent?: Agent
}) {
  const fromAgent = message.author === null
  if (fromAgent && !agent) return null
  return (
    <motion.div {...enter} className="flex gap-3">
      {message.author ? (
        <PersonAvatar person={message.author} className="mt-0.5 size-7" />
      ) : (
        agent && <AgentAvatar agent={agent} size={28} className="mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[14px] font-semibold">
            {message.author ? message.author.name : agent?.name}
          </span>
          <span className="text-[12px] text-muted-foreground/80">
            {message.time}
          </span>
        </div>
        <p className="text-[15px] leading-7">
          <MentionText text={message.text} />
        </p>
        {message.reply && agent && (
          <motion.div {...enter} className="mt-1.5 flex gap-2.5">
            <AgentAvatar agent={agent} size={22} className="mt-0.5" />
            <p className="min-w-0 flex-1 text-[15px] leading-7 text-foreground/90">
              <span className="mr-1.5 text-[14px] font-semibold">
                {agent.name}
              </span>
              {message.reply}
            </p>
          </motion.div>
        )}
        {message.chatId && agent && (
          <ChatLink chatId={message.chatId} agent={agent} />
        )}
      </div>
    </motion.div>
  )
}

// A channel has one agent or none. Adding one is a channel setting; the
// agent brings its own brief, tools and memory with it.
function AgentInChannel({ channel }: { channel: Channel }) {
  const { channelAgents, configured, setChannelAgent, openAgent } = useProto()
  const [picking, setPicking] = useState(false)
  const agent = agentById(channelAgents[channel.id] ?? "")
  if (agent) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => openAgent(agent.id)}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-full border border-border/70 py-1 pr-3 pl-1.5 text-[13px] hover:bg-foreground/[0.04]",
            PRESS
          )}
        >
          <AgentAvatar agent={agent} size={20} />
          <span className="font-medium">{agent.name}</span>
          <span className="text-muted-foreground">is here</span>
        </button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setChannelAgent(channel.id, null)}
        >
          Remove
        </Button>
      </div>
    )
  }
  if (!picking) {
    return (
      <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
        Add an agent
      </Button>
    )
  }
  return (
    <div className="flex shrink-0 items-center gap-1">
      {agents
        .filter((item) => configured[item.id])
        .map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setChannelAgent(channel.id, item.id)
              setPicking(false)
            }}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-full border border-border/70 py-1 pr-2.5 pl-1.5 text-[13px] hover:bg-foreground/[0.04]",
              PRESS
            )}
          >
            <AgentAvatar agent={item} size={20} />
            {item.name}
          </button>
        ))}
      <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
        Cancel
      </Button>
    </div>
  )
}

// A channel: a long-lasting place where people talk. The agent added to it
// reads along, answers a mention, and starts a chat when a mention is work.
export function ChannelView({ channel }: { channel: Channel }) {
  const { channelChat, channelAgents, postChannel } = useProto()
  const [text, setText] = useState("")
  const agent = agentById(channelAgents[channel.id] ?? "")
  const messages = channelChat[channel.id] ?? []
  const outside = channel.place !== "lor"
  const canSend = text.trim().length > 0
  const scroller = useRef<HTMLDivElement>(null)
  const count = messages.length

  // Keep the newest message in view as the channel grows.
  useEffect(() => {
    const element = scroller.current
    if (element && count > 0) element.scrollTop = element.scrollHeight
  }, [count])

  const submit = () => {
    if (!canSend) return
    postChannel(channel.id, text.trim())
    setText("")
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 px-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[15px] font-semibold leading-5">
            <span>#{channel.name}</span>
            {outside && (
              <span className="flex items-center gap-1 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground">
                <PlaceIcon place={channel.place} className="size-3" />
                In {placeNames[channel.place]}
              </span>
            )}
          </div>
          <div className="truncate text-[12.5px] leading-4 text-muted-foreground">
            {channel.topic}
          </div>
        </div>
        <AgentInChannel channel={channel} />
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-end gap-5 px-6 pt-6 pb-6">
          {messages.map((message) => (
            <MessageRow key={message.id} message={message} agent={agent} />
          ))}
        </div>
      </div>

      {outside ? (
        <div className="mx-auto w-full max-w-[720px] shrink-0 px-6 pb-5">
          <div className="flex items-center gap-3 rounded-2xl border border-border/70 px-4 py-3">
            <PlaceIcon
              place={channel.place}
              className="text-muted-foreground"
            />
            <p className="min-w-0 flex-1 text-[13.5px] leading-5 text-muted-foreground">
              This channel lives in {placeNames[channel.place]}. Lor keeps a
              copy, so its chats and search work here.
            </p>
            <Button size="sm" variant="outline">
              Open in {placeNames[channel.place]}
              <HugeiconsIcon
                icon={ArrowUpRight01Icon}
                className="size-3.5"
                strokeWidth={2}
              />
            </Button>
          </div>
        </div>
      ) : (
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
              placeholder={`Message #${channel.name}`}
              className="field-sizing-content block max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
            />
            <SendButton enabled={canSend} onClick={submit} />
          </div>
          <p className="mt-2 text-center text-[11.5px] text-muted-foreground/70">
            {agent
              ? `Mention @${agent.name} to hand it something. A quick question gets a reply here. Work becomes a chat.`
              : "People only. No agent is in this channel."}
          </p>
        </div>
      )}
    </div>
  )
}
