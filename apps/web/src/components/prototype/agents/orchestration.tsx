import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { type Person, people } from "../prototype-data"
import { MentionText, PersonAvatar } from "../prototype-parts"
import { LorMark, Spinner, StateIcon } from "./agents-parts"

// Dev-only explainer for reference/planned/team-agents.md §5: one piece of
// work moving between the thread (in Lor or in Slack), the always-on agent
// with its own computer, and the coding sessions it commands. Not product UI.

type Layer = "talk" | "agent" | "sessions"
type Surface = "lor" | "slack"

type Msg =
  | { id: string; kind: "text"; from: Person | null; text: string }
  | { id: string; kind: "status" }
  | { id: string; kind: "result" }
  | { id: string; kind: "approval" }

type SessionId = "web" | "api"

type Session = {
  id: SessionId
  branch: string
  started: boolean
  state: "running" | "ready" | "pr" | "merged"
  steps: string[]
  pass: number
  pr?: string
}

type Step = {
  rule: string
  caption: string
  flow?: { from: Layer; to: Layer; label: string }
  msgs?: Msg[]
  agent?: { label: string; text: string }[]
  // What the agent is doing on its own computer.
  computer?: string
  sessions?: Partial<Record<SessionId, Partial<Session>>>
  approved?: boolean
}

const samira = people.samira
const eli = people.eli

const steps: Step[] = [
  {
    rule: "A thread starts in the channel",
    caption:
      "Samira asks in #eng and mentions the agent. Her message is the top of a thread, the same way she would ask a teammate. Everyone in the channel can see it and join.",
    flow: { from: "talk", to: "agent", label: "wakes" },
    msgs: [
      {
        id: "m1",
        kind: "text",
        from: samira,
        text: "@Lor customers think Export is broken. The button shows nothing while it runs. Can we show progress?",
      },
    ],
    agent: [{ label: "Woke", text: "Mentioned in #eng by Samira" }],
    computer: "Standing by",
  },
  {
    rule: "The agent looks for itself, on its own computer",
    caption:
      "Like a teammate, the agent has a computer. It is general purpose and keeps its files and logins between threads. Here it opens the live app and reproduces what customers see before it asks anyone to write code.",
    flow: { from: "talk", to: "agent", label: "reads" },
    msgs: [
      {
        id: "m2",
        kind: "text",
        from: null,
        text: "I can reproduce it: the button shows nothing for about 40 seconds. Starting on a fix.",
      },
    ],
    agent: [
      { label: "Read", text: "The thread, 2 memory pages, 3 open threads" },
      { label: "Looked", text: "Opened the live app and clicked Export" },
      { label: "Found", text: "Paygrove reported this on Monday" },
    ],
    computer: "Browser · app.northstar.dev/exports · reproduced it",
  },
  {
    rule: "It commands a swarm of coding agents",
    caption:
      "The fix touches the web app and the API, so the agent starts two sessions. A session is a coding agent on its own branch and dev box, like a cloud coding agent a person would kick off. The agent does not change the repository itself.",
    flow: { from: "agent", to: "sessions", label: "starts two" },
    msgs: [{ id: "m3", kind: "status" }],
    agent: [
      { label: "Decided", text: "Two changes: the button and the job" },
      { label: "Started", text: "2 sessions, one branch each" },
    ],
    sessions: {
      web: { started: true, steps: ["Reading export-button.tsx"] },
      api: { started: true, steps: ["Reading export-job.ts"] },
    },
  },
  {
    rule: "One line per session, never a stream",
    caption:
      "Each session works on its own dev box, which exists mainly to run the app and check the change. The thread shows a single status line per session, updated in place.",
    flow: { from: "sessions", to: "talk", label: "status" },
    sessions: {
      web: {
        steps: [
          "Reading export-button.tsx",
          "Moving the loading state ahead of the request",
          "Running the app and clicking Export twice",
        ],
      },
      api: {
        steps: [
          "Reading export-job.ts",
          "Reporting progress every 500 rows",
          "Running an export of 41,000 rows",
        ],
      },
    },
  },
  {
    rule: "Proof, not a diff",
    caption:
      "The sessions return a clip of the app working, a preview link and the size of each change. The agent watches the clip on its own computer, checks it against what Samira asked, and posts one card.",
    flow: { from: "sessions", to: "agent", label: "return proof" },
    msgs: [
      { id: "m4", kind: "text", from: null, text: "Here it is working." },
      { id: "m5", kind: "result" },
    ],
    agent: [
      { label: "Sessions", text: "Both finished. Checks pass" },
      { label: "Looked", text: "Watched the clip against the ask" },
    ],
    computer: "Browser · the preview link · watched an export run",
    sessions: {
      web: { state: "ready", pass: 1 },
      api: { state: "ready", pass: 1 },
    },
  },
  {
    rule: "People steer in the thread",
    caption:
      "Two people reply with two instructions. Nobody opens an editor. This is the loop Grok Bot's own team described: a long thread, several people, the coding out of sight.",
    flow: { from: "talk", to: "agent", label: "replies" },
    msgs: [
      {
        id: "m6",
        kind: "text",
        from: eli,
        text: "Looks right. Use the existing ProgressBar, not a new component.",
      },
      {
        id: "m7",
        kind: "text",
        from: samira,
        text: "And say “Preparing your export”, not “Exporting”.",
      },
    ],
  },
  {
    rule: "The agent knows whose call it is, and which session",
    caption:
      "Eli owns the code here and Samira owns the wording, so the instructions do not conflict. Both concern the button, so the agent passes them to that session, leaves the other alone, and says what it did.",
    flow: { from: "agent", to: "sessions", label: "passes on" },
    msgs: [
      {
        id: "m8",
        kind: "text",
        from: null,
        text: "Sent both to the web session. The API session is unchanged.",
      },
    ],
    agent: [
      { label: "Read", text: "Two instructions from two people" },
      { label: "Checked", text: "Eli owns the code, Samira the wording" },
      { label: "Sent", text: "Both, to the web session only" },
    ],
    sessions: {
      web: {
        state: "running",
        steps: ["Swapping in ProgressBar", "Changing the label"],
      },
    },
  },
  {
    rule: "Approval is asked by name, in the thread",
    caption:
      "The card updates with the second pass. This channel's trust level is Prepares, so the agent cannot open pull requests alone. It asks the person who may approve.",
    flow: { from: "agent", to: "talk", label: "asks" },
    msgs: [{ id: "m9", kind: "approval" }],
    agent: [
      { label: "Sessions", text: "Second pass finished. Checks pass" },
      { label: "Trust", text: "Prepares: ask before a pull request" },
      { label: "Asked", text: "Eli, who may approve" },
    ],
    sessions: { web: { state: "ready", pass: 2 } },
  },
  {
    rule: "The agent finishes the job",
    caption:
      "Eli approves in the thread, in Slack or in Lor. The agent opens a pull request from each session and watches the checks. At the Acts level it would merge on green.",
    flow: { from: "agent", to: "sessions", label: "opens pull requests" },
    msgs: [
      {
        id: "m10",
        kind: "text",
        from: null,
        text: "Pull requests #431 and #432 are open and the checks are green.",
      },
    ],
    agent: [
      { label: "Approved", text: "By Eli" },
      { label: "Opened", text: "#431 and #432, on Eli's approval" },
    ],
    sessions: {
      web: { state: "pr", pr: "#431" },
      api: { state: "pr", pr: "#432" },
    },
    approved: true,
  },
  {
    rule: "What was decided is kept",
    caption:
      "After the merge the agent writes down what was decided, on its computer and in the team's memory, and tells the agent that was waiting. The dev boxes go away. The thread is stored in Lor wherever it happened.",
    flow: { from: "agent", to: "talk", label: "reports" },
    msgs: [
      {
        id: "m11",
        kind: "text",
        from: null,
        text: "Merged. I told Support so they can reply to Paygrove.",
      },
    ],
    agent: [
      { label: "Saved", text: "Export shows progress since #431" },
      { label: "Saved", text: "Samira decides export wording" },
      { label: "Told", text: "Support's agent: Paygrove is fixed" },
    ],
    computer: "Files · notes/exports.md · wrote down what was decided",
    sessions: { web: { state: "merged" }, api: { state: "merged" } },
  },
]

const blank = (id: SessionId, branch: string): Session => ({
  id,
  branch,
  started: false,
  state: "running",
  steps: [],
  pass: 0,
})

function build(index: number) {
  const msgs: Msg[] = []
  const log: { label: string; text: string }[] = []
  let web = blank("web", "lor/export-progress-web")
  let api = blank("api", "lor/export-progress-api")
  let computer = "Standing by"
  let approved = false
  for (const step of steps.slice(0, index + 1)) {
    msgs.push(...(step.msgs ?? []))
    log.push(...(step.agent ?? []))
    web = { ...web, ...step.sessions?.web }
    api = { ...api, ...step.sessions?.api }
    computer = step.computer ?? computer
    approved = approved || Boolean(step.approved)
  }
  return { msgs, log, sessions: [web, api], computer, approved }
}

const APPROVE_AT = 7

const enter = {
  initial: { opacity: 0, transform: "translateY(8px)" },
  animate: { opacity: 1, transform: "translateY(0px)" },
  transition: { duration: 0.24, ease: EASE_OUT },
}

export function Orchestration() {
  const [index, setIndex] = useState(0)
  const [surface, setSurface] = useState<Surface>("slack")
  const [playing, setPlaying] = useState(false)
  const last = steps.length - 1
  const step = steps[index]
  const { msgs, log, sessions, computer, approved } = build(index)

  useEffect(() => {
    if (!playing) return
    if (index >= last) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => setIndex(index + 1), 4200)
    return () => window.clearTimeout(timer)
  }, [playing, index, last])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setIndex((i) => Math.min(i + 1, last))
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [last])

  if (!step) return null
  const active = (layer: Layer) =>
    step.flow?.from === layer || step.flow?.to === layer

  return (
    <div className="flex h-[100dvh] flex-col bg-sidebar text-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold">
            How one piece of work flows
          </h1>
          <p className="text-[13px] text-muted-foreground">
            The thread, the always-on agent with its own computer, and the
            coding sessions it commands.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          The chat lives in
          <Segmented
            value={surface}
            onChange={setSurface}
            items={[
              { id: "slack", label: "Slack" },
              { id: "lor", label: "Lor" },
            ]}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Previous step"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <span className="w-16 text-center text-[13px] tabular-nums text-muted-foreground">
            {index + 1} of {steps.length}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Next step"
            disabled={index === last}
            onClick={() => setIndex(index + 1)}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (index === last) setIndex(0)
              setPlaying(!playing)
            }}
          >
            <HugeiconsIcon
              icon={playing ? PauseIcon : PlayIcon}
              strokeWidth={2}
            />
            {playing ? "Pause" : "Play"}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1.25fr_0.9fr_0.95fr] gap-3 px-6">
        <Column
          title="The thread"
          subtitle={
            surface === "slack"
              ? "In #eng, in Slack. Where people talk"
              : "In #eng, in Lor. Where people talk"
          }
          active={active("talk")}
          step={index}
        >
          <Thread
            surface={surface}
            msgs={msgs}
            sessions={sessions}
            approved={approved}
            canApprove={index === APPROVE_AT}
            onApprove={() => setIndex(APPROVE_AT + 1)}
          />
        </Column>
        <Column
          title="The agent"
          subtitle="Lor in Eng. A teammate that is always on"
          active={active("agent")}
          step={index}
          pinned={<AgentComputer activity={computer} />}
        >
          <AgentLog log={log} />
        </Column>
        <Column
          title="Sessions"
          subtitle="Coding agents, one branch and one dev box each"
          active={active("sessions")}
          step={index}
        >
          <Sessions sessions={sessions} surface={surface} />
        </Column>
      </div>

      <footer className="shrink-0 px-6 pt-3 pb-5">
        <div className="flex items-start gap-4 rounded-2xl border border-border/70 bg-background px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[15px] font-semibold">{step.rule}</span>
              {step.flow && <FlowChip flow={step.flow} />}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={index}
                initial={{ opacity: 0, filter: "blur(3px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(3px)" }}
                transition={{ duration: 0.16, ease: EASE_OUT }}
                className="mt-1 max-w-[82ch] text-[14px] leading-6 text-muted-foreground"
              >
                {step.caption}
              </motion.p>
            </AnimatePresence>
          </div>
          <div className="flex shrink-0 gap-1 pt-2">
            {steps.map((item, dot) => (
              <button
                key={item.rule}
                type="button"
                aria-label={`Step ${dot + 1}`}
                onClick={() => setIndex(dot)}
                className={cn(
                  "h-1.5 cursor-pointer rounded-full transition-[width,background-color] duration-200 ease-out",
                  dot === index
                    ? "w-5 bg-foreground"
                    : dot < index
                      ? "w-1.5 bg-foreground/40"
                      : "w-1.5 bg-foreground/15"
                )}
              />
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}

const layerName: Record<Layer, string> = {
  talk: "Thread",
  agent: "Agent",
  sessions: "Sessions",
}

function FlowChip({ flow }: { flow: NonNullable<Step["flow"]> }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-agent/10 px-2.5 py-0.5 text-[12.5px] font-medium text-agent">
      {layerName[flow.from]}
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        className="size-3.5"
        strokeWidth={2.2}
      />
      {layerName[flow.to]}
      <span className="font-normal text-agent/80">· {flow.label}</span>
    </span>
  )
}

function Segmented<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T
  items: { id: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex rounded-lg bg-foreground/[0.06] p-0.5">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "relative cursor-pointer rounded-md px-3 py-1 text-[13px] transition-colors duration-150",
            value === item.id
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {value === item.id && (
            <motion.span
              layoutId="surface"
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

function Column({
  title,
  subtitle,
  active,
  step,
  pinned,
  children,
}: {
  title: string
  subtitle: string
  active: boolean
  step: number
  // Stays above the scrolling part of the column.
  pinned?: ReactNode
  children: ReactNode
}) {
  // Keep the newest line in view as the steps advance.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const frame = requestAnimationFrame(() =>
      element.scrollTo({
        top: step === 0 ? 0 : element.scrollHeight,
        behavior: "smooth",
      })
    )
    return () => cancelAnimationFrame(frame)
  }, [step])

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-background transition-[border-color,opacity] duration-300 ease-out",
        active ? "border-agent/50" : "border-border/60 opacity-[0.72]"
      )}
    >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border/60 px-4 py-3">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full transition-colors duration-300",
            active ? "bg-agent" : "bg-foreground/15"
          )}
        />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{title}</div>
          <div className="truncate text-[12.5px] text-muted-foreground">
            {subtitle}
          </div>
        </div>
      </div>
      {pinned}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </section>
  )
}

function Thread({
  surface,
  msgs,
  sessions,
  approved,
  canApprove,
  onApprove,
}: {
  surface: Surface
  msgs: Msg[]
  sessions: Session[]
  approved: boolean
  canApprove: boolean
  onApprove: () => void
}) {
  const slack = surface === "slack"
  return (
    <div className={cn("flex flex-col px-4 py-4", slack ? "gap-4" : "gap-5")}>
      {msgs.map((msg) => (
        <motion.div key={msg.id} {...enter} className="flex gap-3">
          <Face from={msg.kind === "text" ? msg.from : null} slack={slack} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[14px] font-semibold">
                {msg.kind === "text" && msg.from ? msg.from.name : "Lor"}
              </span>
              {slack && !(msg.kind === "text" && msg.from) && (
                <span className="rounded bg-foreground/[0.08] px-1 text-[10px] font-semibold text-muted-foreground">
                  APP
                </span>
              )}
            </div>
            {msg.kind === "text" && (
              <p className="text-[14.5px] leading-6">
                <MentionText text={msg.text} />
              </p>
            )}
            {msg.kind === "status" && (
              <div className="mt-1 flex flex-col gap-1">
                {sessions
                  .filter((session) => session.started)
                  .map((session) => (
                    <StatusLine key={session.id} session={session} />
                  ))}
              </div>
            )}
            {msg.kind === "result" && (
              <ResultCard sessions={sessions} slack={slack} />
            )}
            {msg.kind === "approval" && (
              <div
                className={cn(
                  "mt-1 border border-warning/45 px-3.5 py-3",
                  slack ? "rounded-lg" : "rounded-2xl"
                )}
              >
                <p className="text-[14.5px] leading-6">
                  <MentionText text="Checks pass on both. Ready for two pull requests. @Eli can approve." />
                </p>
                <div className="mt-2.5 flex items-center gap-2.5">
                  {approved ? (
                    <span className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
                      <StateIcon state="done" />
                      Approved by Eli
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={!canApprove}
                      onClick={onApprove}
                    >
                      Approve
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  )
}

function Face({ from, slack }: { from: Person | null; slack: boolean }) {
  if (from) {
    return (
      <PersonAvatar
        person={from}
        className={cn("mt-0.5 size-8", slack && "rounded-md")}
      />
    )
  }
  return (
    <span
      className={cn(
        "mt-0.5 flex size-8 shrink-0 items-center justify-center bg-agent/12",
        slack ? "rounded-md" : "rounded-full"
      )}
    >
      <LorMark className="size-4" />
    </span>
  )
}

function StatusLine({ session }: { session: Session }) {
  const running = session.state === "running"
  return (
    <div className="flex items-center gap-2.5 text-[13.5px]">
      {running ? <Spinner /> : <StateIcon state="done" />}
      <span className="w-8 shrink-0 font-medium">{session.id}</span>
      <span
        className={cn(
          "min-w-0 truncate text-muted-foreground",
          running && "shimmer"
        )}
      >
        {running
          ? session.steps.at(-1)
          : session.state === "merged"
            ? "merged"
            : session.state === "pr"
              ? `pull request ${session.pr}`
              : "ready to look at"}
      </span>
    </div>
  )
}

function ResultCard({
  sessions,
  slack,
}: {
  sessions: Session[]
  slack: boolean
}) {
  const second = sessions.some((session) => session.pass > 1)
  return (
    <div
      className={cn(
        "mt-1.5 overflow-hidden border border-border/70",
        slack ? "rounded-lg border-l-[3px] border-l-agent" : "rounded-2xl"
      )}
    >
      <div className="flex items-center gap-3 bg-foreground/[0.03] px-3.5 py-3">
        <div className="flex h-14 w-24 shrink-0 flex-col justify-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5">
          <span className="text-[9.5px] font-medium">
            {second ? "Preparing your export" : "Exporting"}
          </span>
          <span className="h-1 overflow-hidden rounded-full bg-foreground/10">
            <span className="block h-full w-2/3 rounded-full bg-agent" />
          </span>
        </div>
        <div className="min-w-0 flex-1 text-[13px]">
          <div className="font-medium">
            12 second clip
            {second && (
              <span className="ml-2 rounded-md bg-agent/10 px-1.5 py-0.5 text-[11px] text-agent">
                Second pass
              </span>
            )}
          </div>
          <div className="text-muted-foreground">
            web {second ? "+19 −9" : "+21 −6"} · api +14 −3 · checks pass
          </div>
        </div>
      </div>
      <div className="flex gap-4 px-3.5 py-2 text-[13px] font-medium">
        <span className="text-agent">Preview</span>
        <span className="text-agent">
          {slack ? "Open in Lor" : "Open the sessions"}
        </span>
      </div>
    </div>
  )
}

function AgentComputer({ activity }: { activity: string }) {
  const idle = activity === "Standing by"
  return (
    <div className="shrink-0 border-b border-border/60 px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-muted-foreground">
          Its own computer
        </span>
        <span className="text-[11.5px] text-muted-foreground/80">
          General purpose. Keeps its files and logins
        </span>
      </div>
      <div className="mt-2 rounded-xl border border-border/70 bg-foreground/[0.03] px-3 py-2.5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activity}
            initial={{ opacity: 0, filter: "blur(3px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(3px)" }}
            transition={{ duration: 0.16, ease: EASE_OUT }}
            className={cn(
              "font-mono text-[12px] leading-5",
              idle ? "text-muted-foreground/70" : "text-foreground/90"
            )}
          >
            {activity}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function AgentLog({ log }: { log: { label: string; text: string }[] }) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-4">
      {log.map((entry, position) => (
        <motion.div
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only log
          key={position}
          {...enter}
          className="grid grid-cols-[68px_1fr] gap-2 text-[13.5px] leading-5"
        >
          <span
            className={cn(
              "text-muted-foreground",
              entry.label === "Saved" && "text-agent"
            )}
          >
            {entry.label}
          </span>
          <span>{entry.text}</span>
        </motion.div>
      ))}
    </div>
  )
}

function Sessions({
  sessions,
  surface,
}: {
  sessions: Session[]
  surface: Surface
}) {
  const started = sessions.filter((session) => session.started)
  if (started.length === 0) {
    return (
      <p className="px-4 py-4 text-[13.5px] leading-5 text-muted-foreground">
        No sessions yet. The agent starts one when a repository has to change,
        and as many as the work splits into.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      {started.map((session) => {
        const running = session.state === "running"
        return (
          <motion.div
            key={session.id}
            {...enter}
            className="overflow-hidden rounded-2xl border border-border/70"
          >
            <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-1">
              {running ? <Spinner /> : <StateIcon state="done" />}
              <span className="text-[14px] font-medium">{session.id}</span>
              {session.pass > 0 && (
                <span className="ml-auto text-[12.5px] text-muted-foreground">
                  pass {session.pass}
                </span>
              )}
            </div>
            <div className="px-3.5 pb-2.5 font-mono text-[12px] text-muted-foreground">
              {session.branch}
            </div>
            <div className="flex flex-col gap-1 border-t border-border/60 px-3.5 py-2.5">
              {session.steps.map((item, position) => (
                <motion.div
                  key={item}
                  {...enter}
                  className={cn(
                    "text-[13px] leading-5",
                    running && position === session.steps.length - 1
                      ? "shimmer text-muted-foreground"
                      : "text-muted-foreground/70"
                  )}
                >
                  {item}
                </motion.div>
              ))}
            </div>
            {session.pass > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-3.5 py-2.5">
                {["Clip", "Preview", "Changes"].map((artifact) => (
                  <span
                    key={artifact}
                    className="rounded-lg bg-foreground/[0.05] px-2 py-1 text-[12.5px]"
                  >
                    {artifact}
                  </span>
                ))}
                {session.pr && (
                  <span className="rounded-lg bg-success/12 px-2 py-1 text-[12.5px] text-success">
                    {session.pr}
                    {session.state === "merged" && " merged"}
                  </span>
                )}
              </div>
            )}
          </motion.div>
        )
      })}
      <p className="text-[12.5px] leading-5 text-muted-foreground">
        A dev box exists to run the app and prove the change works. Anyone can
        open a session in Lor to see its changes or take it over.
        {surface === "slack" &&
          " From Slack that is a link: Slack cannot show a live computer."}
      </p>
    </div>
  )
}
