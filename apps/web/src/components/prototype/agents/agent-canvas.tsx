import {
  ArrowUp02Icon,
  Cancel01Icon,
  Clock01Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { motion } from "motion/react"
import { type ReactNode, useEffect, useState } from "react"
import { me, type Person, people } from "../prototype-data"
import { MentionText, PersonAvatar } from "../prototype-parts"
import { Bars, LiveSteps } from "./agent-blocks"
import {
  type Agent,
  agentById,
  charts,
  diffFiles,
  type LogOutcome,
  logEvents,
  roomName,
  trustLevels,
  type Work,
} from "./agents-data"
import { LorMark, PRESS, StateIcon } from "./agents-parts"
import { type Canvas, useProto, type WorkTab } from "./agents-store"

const everyone = Object.values(people)

function Shell({
  title,
  subtitle,
  tabs,
  footer,
  main,
  children,
}: {
  title: string
  subtitle: string
  tabs?: ReactNode
  footer?: ReactNode
  // The session fills the main area instead of the panel beside a chat.
  main?: boolean
  children: ReactNode
}) {
  const { closeCanvas } = useProto()
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 pr-3 pl-5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-5">
            {title}
          </div>
          <div className="truncate text-[12.5px] leading-4 text-muted-foreground">
            {subtitle}
          </div>
        </div>
        {tabs}
        {!main && (
          <button
            type="button"
            onClick={closeCanvas}
            aria-label="Close"
            className={cn(
              "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
              PRESS
            )}
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              className="size-[18px]"
              strokeWidth={1.8}
            />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={
            main
              ? "mx-auto flex min-h-full w-full max-w-[820px] flex-col [&>*]:flex-1"
              : "contents"
          }
        >
          {children}
        </div>
      </div>
      {footer}
    </div>
  )
}

function Tabs<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T
  items: { id: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex shrink-0 rounded-lg bg-foreground/[0.05] p-0.5">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "relative cursor-pointer rounded-md px-2.5 py-1 text-[13px] transition-colors duration-150",
            value === item.id
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {value === item.id && (
            <motion.span
              layoutId="canvas-tab"
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="absolute inset-0 rounded-md bg-background shadow-sm dark:bg-foreground/10"
            />
          )}
          <span className="relative">{item.label}</span>
        </button>
      ))}
    </div>
  )
}

function Diff() {
  const [path, setPath] = useState(diffFiles[0]?.path)
  const file = diffFiles.find((item) => item.path === path) ?? diffFiles[0]
  if (!file) return null
  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap gap-1.5">
        {diffFiles.map((item) => (
          <button
            key={item.path}
            type="button"
            onClick={() => setPath(item.path)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1 font-mono text-[12px]",
              PRESS,
              item.path === file.path
                ? "border-border bg-foreground/[0.05] text-foreground"
                : "border-transparent text-muted-foreground hover:bg-foreground/[0.04]"
            )}
          >
            {item.path.split("/").at(-1)}
            <span className="text-success">+{item.added}</span>
            <span className="text-destructive">−{item.removed}</span>
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border/70">
        <div className="border-b border-border/60 px-3 py-2 font-mono text-[12px] text-muted-foreground">
          {file.path}
        </div>
        <div className="overflow-x-auto py-1.5 font-mono text-[12.5px] leading-6">
          {file.lines.map((line, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static sample diff
              key={index}
              className={cn(
                "flex min-w-max",
                line.kind === "add" && "bg-success/10",
                line.kind === "del" && "bg-destructive/10"
              )}
            >
              <span
                className={cn(
                  "w-7 shrink-0 select-none text-center",
                  line.kind === "add" && "text-success",
                  line.kind === "del" && "text-destructive"
                )}
              >
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
              </span>
              <span
                className={cn(
                  "whitespace-pre pr-4",
                  line.kind === "ctx" && "text-foreground/70"
                )}
              >
                {line.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// The running app, as the agent's own computer shows it.
function MockApp() {
  const [run, setRun] = useState(0)
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle")

  useEffect(() => {
    setPhase("idle")
    const frame = requestAnimationFrame(() => setPhase("running"))
    return () => cancelAnimationFrame(frame)
  }, [run])

  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-foreground/15" />
            <span className="size-2.5 rounded-full bg-foreground/15" />
            <span className="size-2.5 rounded-full bg-foreground/15" />
          </span>
          <span className="mx-auto rounded-md bg-foreground/[0.05] px-3 py-0.5 font-mono text-[11.5px] text-muted-foreground">
            localhost:3000/exports
          </span>
        </div>
        <div className="p-5">
          <div className="text-[17px] font-semibold">Exports</div>
          <div className="mt-4 rounded-xl border border-border/70 p-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium">orders.csv</div>
                <div className="text-[13px] text-muted-foreground">
                  Paygrove · 41,000 rows
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={phase !== "done"}
                onClick={() => setRun((count) => count + 1)}
              >
                {phase === "done" ? "Export again" : "Exporting"}
              </Button>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
              <div
                onTransitionEnd={() => setPhase("done")}
                style={{
                  transform: `scaleX(${phase === "idle" ? 0 : 1})`,
                  transitionDuration: phase === "idle" ? "0ms" : "2600ms",
                }}
                className="h-full origin-left rounded-full bg-agent transition-transform ease-linear"
              />
            </div>
            <div className="mt-2 text-[13px] text-muted-foreground">
              {phase === "done"
                ? "Ready in 38 seconds. Resumed once, from row 25,000."
                : "Writing rows. A retry now resumes where it stopped."}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-xl px-4 py-2.5 text-[13px] text-muted-foreground">
            <span className="flex-1">invoices.csv · Lumen Health</span>
            Ready
          </div>
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">
        This is the app running on the session's own computer. Anyone here can
        take over the browser.
      </p>
    </div>
  )
}

function Turn({
  author,
  children,
}: {
  author: Person | null
  children: ReactNode
}) {
  return (
    <div className="flex gap-3">
      {author ? (
        <PersonAvatar person={author} className="mt-0.5 size-7" />
      ) : (
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-agent/12">
          <LorMark className="size-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">
          {author ? author.name : "Lor"}
        </div>
        {children}
      </div>
    </div>
  )
}

// The session's own conversation: Lor's account of the work, then whoever
// steers it or talks about it. It does not show in the agent's chat.
function SessionChat({ work }: { work: Work }) {
  const { reply } = useProto()
  const [text, setText] = useState("")
  const submit = () => {
    if (!text.trim()) return
    reply(work.id, text.trim())
    setText("")
  }
  return (
    <div className="flex min-h-full flex-col gap-6 p-5">
      {work.prompt && (
        <Turn author={work.owner}>
          <p className="text-[15px] leading-7">{work.prompt}</p>
        </Turn>
      )}
      <Turn author={null}>
        {work.summary && (
          <p className="whitespace-pre-line text-[15px] leading-7 text-foreground/90">
            {work.summary.replaceAll("**", "")}
          </p>
        )}
        <div className="mt-2 rounded-xl bg-foreground/[0.03] px-3.5 py-3">
          <div className="mb-1.5 text-[12.5px] font-medium text-muted-foreground">
            {work.state === "running" ? "What it's doing" : "What it did"}
          </div>
          <LiveSteps work={work} limit={12} />
        </div>
      </Turn>
      {work.replies.map((item) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, transform: "translateY(8px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ duration: 0.24, ease: EASE_OUT }}
        >
          <Turn author={item.author}>
            <p className="text-[15px] leading-7">
              <MentionText text={item.text} />
            </p>
          </Turn>
        </motion.div>
      ))}
      <div className="mt-auto">
        <div className="flex items-end gap-2 rounded-[20px] border border-input py-1.5 pr-1.5 pl-4 focus-within:border-muted-foreground/50">
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
            placeholder="Steer this work, or @mention a teammate"
            className="field-sizing-content block max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim()}
            aria-label="Send in this session"
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full transition-[transform,background-color] duration-150 ease-out",
              text.trim()
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
          Stays in this session. Only the people in it are notified.
        </p>
      </div>
    </div>
  )
}

export function WorkCanvas({
  work,
  tab,
  main,
}: {
  work: Work
  tab?: WorkTab
  main?: boolean
}) {
  const { approve } = useProto()
  const agent = agentById(work.agentId)
  const [active, setActive] = useState<WorkTab>(tab ?? "chat")
  const items: { id: WorkTab; label: string }[] = [
    { id: "chat", label: "Chat" },
    ...(work.diff ? [{ id: "changes" as const, label: "Changes" }] : []),
    ...(work.app ? [{ id: "preview" as const, label: "Preview" }] : []),
  ]
  const shown = items.some((item) => item.id === active) ? active : "chat"
  // A code session has a repo, a branch and a dev box. Other work runs on the
  // agent's own computer.
  const where =
    work.mode === "code"
      ? `Code session · ${work.repo ?? agent?.name} · ${work.branch ?? "branch"}`
      : `On ${agent?.name}'s own computer`

  const owner =
    work.owner.id === me.id
      ? "you own it"
      : `${work.owner.name.split(" ")[0]} owns it`

  return (
    <Shell
      main={main}
      title={work.title}
      subtitle={`${where} · ${owner} · ${work.facts ?? (work.state === "running" ? "working" : (work.result ?? "done"))}`}
      tabs={<Tabs value={shown} items={items} onChange={setActive} />}
      footer={
        work.state === "needs_you" && (
          <div className="flex shrink-0 items-center gap-3 border-t border-border/60 px-5 py-3">
            <StateIcon state="needs_you" />
            <span className="min-w-0 flex-1 truncate text-[14px]">
              Wants to {work.ask?.toLowerCase()}
            </span>
            <Button size="sm" onClick={() => approve(work.id)}>
              Approve
            </Button>
          </div>
        )
      }
    >
      {shown === "chat" && <SessionChat work={work} />}
      {shown === "changes" && <Diff />}
      {shown === "preview" && <MockApp />}
    </Shell>
  )
}

function DraftCanvas({ draftId }: { draftId: string }) {
  const { drafts, editDraft, sendDraft } = useProto()
  const draft = drafts[draftId]
  if (!draft) return null
  return (
    <Shell
      title={draft.subject}
      subtitle={`${agentById(draft.agentId)?.name} · Draft reply`}
      footer={
        <div className="flex shrink-0 items-center gap-3 border-t border-border/60 px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground">
            {draft.sent
              ? `Sent to ${draft.to}`
              : "Goes out from support@northstar.dev"}
          </span>
          <Button
            size="sm"
            disabled={draft.sent}
            onClick={() => sendDraft(draft.id)}
          >
            {draft.sent ? "Sent" : "Send reply"}
          </Button>
        </div>
      }
    >
      <div className="flex min-h-full flex-col p-5">
        <dl className="grid grid-cols-[64px_1fr] gap-y-2 border-b border-border/60 pb-4 text-[14px]">
          <dt className="text-muted-foreground">To</dt>
          <dd>{draft.to}</dd>
          <dt className="text-muted-foreground">Subject</dt>
          <dd>{draft.subject}</dd>
        </dl>
        <textarea
          value={draft.body}
          readOnly={draft.sent}
          onChange={(event) => editDraft(draft.id, event.target.value)}
          aria-label="Reply"
          className="mt-4 min-h-64 flex-1 resize-none bg-transparent text-[15px] leading-7 outline-none"
        />
      </div>
    </Shell>
  )
}

function ChartCanvas({ chartId }: { chartId: string }) {
  const chart = charts.find((item) => item.id === chartId)
  if (!chart) return null
  const max = Math.max(...chart.rows.map((row) => row.value))
  return (
    <Shell title={chart.title} subtitle="Eng · From Better Stack">
      <div className="flex flex-col gap-6 p-5">
        <div>
          <span className="text-[34px] font-semibold tracking-tight tabular-nums">
            {chart.total}
          </span>
          <span className="ml-3 text-[14px] text-success">{chart.delta}</span>
        </div>
        <Bars chart={chart} tall />
        <div className="flex flex-col gap-3">
          {chart.rows.map((row) => (
            <div key={row.label} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-[14px]">
                {row.label}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                <span
                  style={{ width: `${(row.value / max) * 100}%` }}
                  className="block h-full rounded-full bg-foreground/25"
                />
              </span>
              <span className="w-8 shrink-0 text-right text-[13px] tabular-nums">
                {row.value}
              </span>
              <span className="hidden w-40 shrink-0 truncate text-[13px] text-muted-foreground lg:block">
                {row.status}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[14px] leading-6 text-muted-foreground">
          {chart.note}
        </p>
      </div>
    </Shell>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-border/60 px-5 py-4 last:border-b-0">
      <h3 className="mb-2 text-[12.5px] font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

function SetupCanvas({ agent }: { agent: Agent }) {
  const { configured, rooms } = useProto()
  const room = rooms[agent.id]
  if (!configured[agent.id]) {
    return (
      <Shell title={`${agent.name} setup`} subtitle="Not set up yet">
        <p className="p-5 text-[15px] leading-7 text-muted-foreground">
          Tell {agent.name} what to look after in the chat. Lor proposes the
          setup and you approve it once.
        </p>
      </Shell>
    )
  }
  return (
    <Shell
      title={`${agent.name} setup`}
      subtitle="Lor's own edits wait for approval"
    >
      <Section title="Brief">
        <p className="text-[15px] leading-7 text-foreground/90">
          {agent.brief}
        </p>
      </Section>
      <Section title="Watching">
        <div className="flex flex-col gap-3">
          {agent.watching.map((watch) => (
            <div key={watch.id} className="flex items-center gap-3">
              <HugeiconsIcon
                icon={watch.kind === "schedule" ? Clock01Icon : ZapIcon}
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px]">{watch.label}</div>
                <div className="truncate text-[12.5px] text-muted-foreground">
                  {trustLevels[watch.level].text}
                </div>
              </div>
              <span
                title={`${watch.owner.name} answers for this`}
                className="shrink-0"
              >
                <PersonAvatar person={watch.owner} className="size-6" />
              </span>
              <span className="w-[74px] shrink-0 rounded-lg bg-foreground/[0.05] py-1 text-center text-[12.5px] font-medium">
                {trustLevels[watch.level].label}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] leading-5 text-muted-foreground">
          Each watch has a person who answers for it and a level. Levels go up
          as trust does: observes, prepares, acts, owns.
        </p>
      </Section>
      <Section title="Tools">
        <div className="flex flex-wrap gap-1.5">
          {agent.tools.map((tool) => (
            <span
              key={tool}
              className="rounded-lg bg-foreground/[0.05] px-2.5 py-1 text-[13px]"
            >
              {tool}
            </span>
          ))}
        </div>
      </Section>
      <Section title="Prompts">
        {agent.prompts.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">
            No saved prompts yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {agent.prompts.map((prompt) => (
              <div key={prompt.name} className="text-[14px]">
                <span className="font-mono text-[13px] text-agent">
                  /{prompt.name}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {prompt.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="People">
        <div className="flex items-center gap-2.5 text-[14px]">
          <span className="flex -space-x-1.5">
            {everyone.map((person) => (
              <PersonAvatar
                key={person.id}
                person={person}
                className="size-6 ring-2 ring-background"
              />
            ))}
          </span>
          Everyone at Northstar
        </div>
      </Section>
      <Section title="Reaching people">
        <p className="text-[14px] leading-6 text-muted-foreground">
          {room
            ? `In the app, by push, and in ${roomName(room, agent)}, where it answers in threads.`
            : "In the app and by push. No chat is linked."}
          {agent.handoffs.length > 0 && ` ${agent.handoffs.join(". ")}.`}
        </p>
      </Section>
    </Shell>
  )
}

const OUTCOME: Record<LogOutcome, { label: string; className: string }> = {
  passed: {
    label: "Passed",
    className: "bg-foreground/[0.06] text-muted-foreground",
  },
  noted: { label: "Noted", className: "bg-info/10 text-info-foreground" },
  worked: { label: "Worked", className: "bg-agent/10 text-agent" },
  asked: { label: "Asked", className: "bg-warning/12 text-warning-foreground" },
}

function LogCanvas({ agent }: { agent: Agent }) {
  const events = logEvents.filter((event) => event.agentId === agent.id)
  const passed = events.filter((event) => event.outcome === "passed").length
  return (
    <Shell
      title={`${agent.name} activity`}
      subtitle={`Everything that reached it today. ${passed} passed without a word.`}
    >
      <div className="flex flex-col">
        {events.length === 0 && (
          <p className="p-5 text-[14px] text-muted-foreground">
            Nothing has reached {agent.name} yet.
          </p>
        )}
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-start gap-3 border-b border-border/60 px-5 py-3 last:border-b-0"
          >
            <span className="w-10 shrink-0 pt-0.5 font-mono text-[12px] text-muted-foreground">
              {event.time}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-5">
                <span className="text-muted-foreground">{event.source}</span>{" "}
                {event.text}
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {event.reason}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                OUTCOME[event.outcome].className
              )}
            >
              {OUTCOME[event.outcome].label}
            </span>
          </div>
        ))}
      </div>
    </Shell>
  )
}

export function AgentCanvas({ canvas }: { canvas: Canvas }) {
  const { works } = useProto()
  if (canvas.kind === "work") {
    const work = works[canvas.workId]
    if (!work) return null
    return (
      <WorkCanvas
        key={`${work.id}-${canvas.tab ?? "chat"}`}
        work={work}
        tab={canvas.tab}
      />
    )
  }
  if (canvas.kind === "draft") return <DraftCanvas draftId={canvas.draftId} />
  if (canvas.kind === "chart") return <ChartCanvas chartId={canvas.chartId} />
  const agent = agentById(canvas.agentId)
  if (!agent) return null
  return canvas.kind === "setup" ? (
    <SetupCanvas agent={agent} />
  ) : (
    <LogCanvas agent={agent} />
  )
}
