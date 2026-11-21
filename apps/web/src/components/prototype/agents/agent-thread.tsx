import { ArrowUp02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { AnimatePresence, motion } from "motion/react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { me } from "../prototype-data"
import { MentionText, PersonAvatar } from "../prototype-parts"
import { BlockView, Spark } from "./agent-blocks"
import {
  type Agent,
  agentById,
  charts,
  starterLine,
  type Thread,
  type ThreadItem,
} from "./agents-data"
import { AgentAvatar, LorMark, PRESS } from "./agents-parts"
import { ThreadProvider, useProto } from "./agents-store"

// A thread with a channel's agent: one piece of work, the people on it,
// and cards for the code sessions the agent runs under it.
export function ThreadView({ thread }: { thread: Thread }) {
  const { transcripts, pins, openCanvas, openAgent, send, childrenOf } =
    useProto()
  const agent = agentById(thread.agentId)
  const items = transcripts[thread.id] ?? []
  const scroller = useRef<HTMLDivElement>(null)
  const seen = useRef(0)
  const count = items.length

  // Follow the conversation: jump on open, glide when something arrives or a
  // card grows, unless the reader has scrolled up.
  const content = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    element.scrollTo({
      top: element.scrollHeight,
      behavior: seen.current === 0 ? "auto" : "smooth",
    })
    stuck.current = true
    seen.current = count
  }, [count])
  useEffect(() => {
    const element = scroller.current
    const inner = content.current
    if (!element || !inner) return
    const onScroll = () => {
      stuck.current =
        element.scrollHeight - element.scrollTop - element.clientHeight < 120
    }
    const observer = new ResizeObserver(() => {
      if (stuck.current) {
        element.scrollTo({ top: element.scrollHeight, behavior: "smooth" })
      }
    })
    element.addEventListener("scroll", onScroll, { passive: true })
    observer.observe(inner)
    observer.observe(element)
    return () => {
      element.removeEventListener("scroll", onScroll)
      observer.disconnect()
    }
  }, [])

  if (!agent) return null
  const pinned = charts.filter((chart) =>
    (pins[agent.id] ?? []).includes(chart.id)
  )
  const owner =
    thread.owner.id === me.id
      ? "you own it"
      : `${thread.owner.name.split(" ")[0]} owns it`
  // A thread has no repo of its own. It shows the ones its sessions touch.
  const code = childrenOf(thread.id).filter((work) => work.mode === "code")
  const repos = [...new Set(code.flatMap((work) => work.repo ?? []))]
  const spans =
    code.length === 0
      ? "no code sessions"
      : `${code.length} code ${code.length === 1 ? "session" : "sessions"} in ${repos.join(", ")}`

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 px-5">
        <button
          type="button"
          onClick={() => openAgent(agent.id)}
          aria-label={`Open ${agent.name}`}
          title={`Open ${agent.name}`}
          className={cn("cursor-pointer rounded-[10px]", PRESS)}
        >
          <AgentAvatar agent={agent} className="size-8" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-5">
            {thread.title}
          </div>
          <div className="truncate text-[12.5px] leading-4 text-muted-foreground">
            {agent.name} · {starterLine(thread.starter)} · {owner} · {spans}
          </div>
        </div>
        <span className="mr-1 hidden -space-x-1.5 sm:flex">
          {thread.people.map((person) => (
            <PersonAvatar
              key={person.id}
              person={person}
              className="size-6 ring-2 ring-background"
            />
          ))}
        </span>
      </header>

      <AnimatePresence initial={false}>
        {pinned.map((chart) => (
          <motion.button
            key={chart.id}
            type="button"
            onClick={() => openCanvas({ kind: "chart", chartId: chart.id })}
            initial={{ opacity: 0, transform: "translateY(-6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            exit={{ opacity: 0, transform: "translateY(-6px)" }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="mx-5 mb-1 flex cursor-pointer items-center gap-4 rounded-xl border border-border/70 px-4 py-2.5 text-left hover:bg-foreground/[0.03]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] text-muted-foreground">
                Pinned · {chart.title}
              </span>
              <span className="text-[17px] font-semibold tracking-tight tabular-nums">
                {chart.total}
              </span>
              <span className="ml-2 text-[13px] text-success">
                {chart.delta}
              </span>
            </span>
            <Spark chart={chart} />
          </motion.button>
        ))}
      </AnimatePresence>

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full overflow-y-auto">
          <div
            ref={content}
            className="mx-auto flex w-full max-w-[720px] flex-col gap-7 px-6 pt-5 pb-8"
          >
            <ThreadProvider value={thread.id}>
              {items.map((item) => (
                <ThreadRow key={item.id} item={item} agent={agent} />
              ))}
            </ThreadProvider>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-background to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-background to-transparent" />
      </div>

      <Composer agent={agent} onSend={(text) => send(thread.id, text)} />
    </div>
  )
}

const enter = {
  initial: { opacity: 0, transform: "translateY(8px)" },
  animate: { opacity: 1, transform: "translateY(0px)" },
  transition: { duration: 0.24, ease: EASE_OUT },
}

function ThreadRow({ item, agent }: { item: ThreadItem; agent: Agent }) {
  if (item.kind === "person") {
    if (item.author.id === me.id) {
      return (
        <motion.div {...enter} className="flex justify-end">
          <p className="max-w-[80%] rounded-[20px] rounded-br-md bg-foreground/[0.07] px-4 py-2.5 text-[15px] leading-6">
            <MentionText text={item.text} />
          </p>
        </motion.div>
      )
    }
    return (
      <motion.div {...enter} className="flex gap-3">
        <PersonAvatar person={item.author} className="mt-0.5 size-7" />
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
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div {...enter} className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-agent/12">
        <LorMark className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-semibold">Lor</span>
            {item.woke && (
              <span className="text-[12px] text-muted-foreground">
                {item.woke}
              </span>
            )}

            <span className="text-[12px] text-muted-foreground/80">
              {item.time}
            </span>
          </div>
          {item.pending ? (
            <p className="shimmer text-[15px] leading-7 text-muted-foreground">
              Thinking
            </p>
          ) : (
            item.text && (
              <motion.p
                initial={{ opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                transition={{ duration: 0.24, ease: EASE_OUT }}
                className="text-[15px] leading-7 text-foreground/90"
              >
                {item.text}
              </motion.p>
            )
          )}
        </div>
        {item.blocks?.map((block, index) => (
          <motion.div
            // Blocks never reorder within a message.
            // biome-ignore lint/suspicious/noArrayIndexKey: static list
            key={index}
            {...enter}
            transition={{ ...enter.transition, delay: 0.06 + index * 0.05 }}
          >
            <BlockView block={block} agent={agent} />
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

function Composer({
  agent,
  onSend,
}: {
  agent: Agent
  onSend: (text: string) => void
}) {
  const [text, setText] = useState("")
  const canSend = text.trim().length > 0

  const submit = (value: string) => {
    if (!value.trim()) return
    onSend(value.trim())
    setText("")
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit(text)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[720px] shrink-0 px-6 pb-5">
      <div className="flex items-end gap-2 rounded-[22px] border border-input bg-background py-2 pr-2 pl-4 shadow-sm transition-colors duration-150 focus-within:border-muted-foreground/50 dark:bg-foreground/[0.04]">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={`Reply to ${agent.name}, or @mention a teammate`}
          className="field-sizing-content block max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => submit(text)}
          disabled={!canSend}
          aria-label="Send"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 ease-out",
            canSend
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
      </div>
      <p className="mt-2 text-center text-[11.5px] text-muted-foreground/70">
        Everyone in {agent.name} can open this thread. Only the people in it are
        notified.
      </p>
    </div>
  )
}
