import {
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Mail01Icon,
  Pin02Icon,
  PinOffIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useEffect, useState } from "react"
import { PersonAvatar } from "../prototype-parts"
import {
  type Agent,
  type Block,
  type Chart,
  charts,
  leads,
  templates,
  type Work,
} from "./agents-data"
import { PRESS, StateIcon } from "./agents-parts"
import { useChatId, useProto } from "./agents-store"

export const CARD =
  "overflow-hidden rounded-2xl border border-border/70 bg-foreground/[0.025]"

const swap = {
  initial: { opacity: 0, filter: "blur(4px)" },
  animate: { opacity: 1, filter: "blur(0px)" },
  exit: { opacity: 0, filter: "blur(4px)" },
  transition: { duration: 0.16, ease: EASE_OUT },
}

// A running piece of work reveals its steps one by one and holds on the last.
function useLiveSteps(work: Work | undefined) {
  const running = work?.state === "running"
  const total = work?.steps.length ?? 0
  const [shown, setShown] = useState(1)
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(
      () => setShown((count) => Math.min(count + 1, total)),
      1900
    )
    return () => window.clearInterval(timer)
  }, [running, total])
  return running ? Math.min(shown, total) : total
}

export function LiveSteps({ work, limit = 3 }: { work: Work; limit?: number }) {
  const shown = useLiveSteps(work)
  if (work.doing) {
    return (
      <p className="shimmer text-[13.5px] text-muted-foreground">
        {work.doing}
      </p>
    )
  }
  const steps = work.steps.slice(0, shown)
  const running = work.state === "running"
  return (
    <ol className="flex flex-col gap-1">
      {steps.slice(-limit).map((step, index, visible) => {
        const current = running && index === visible.length - 1
        return (
          <motion.li
            key={step}
            initial={{ opacity: 0, transform: "translateY(4px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className={cn(
              "text-[13.5px] leading-5",
              current
                ? "shimmer text-muted-foreground"
                : "text-muted-foreground/70"
            )}
          >
            {step}
          </motion.li>
        )
      })}
    </ol>
  )
}

export function WorkCard({ workId }: { workId: string }) {
  const { works, openCanvas, approve } = useProto()
  const work = works[workId]
  if (!work) return null
  const open = () => openCanvas({ kind: "work", workId })

  return (
    <div
      id={`work-${work.id}`}
      className={cn(
        CARD,
        "scroll-mt-20 transition-colors duration-200",
        work.state === "needs_you" && "border-warning/45"
      )}
    >
      <button
        type="button"
        onClick={open}
        className="group flex w-full cursor-pointer items-center gap-3 px-4 pt-3.5 pb-2.5 text-left"
      >
        <StateIcon state={work.state} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
          {work.title}
        </span>
        {work.facts && (
          <span className="hidden shrink-0 text-[13px] text-muted-foreground sm:block">
            {work.facts}
          </span>
        )}
        <span title={`${work.asker.name} asked for this`} className="shrink-0">
          <PersonAvatar person={work.asker} className="size-5" />
        </span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="size-4 shrink-0 text-muted-foreground/50 transition-transform duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-foreground"
          strokeWidth={2}
        />
      </button>
      <div className="px-4 pb-3.5 pl-[44px]">
        <AnimatePresence mode="wait" initial={false}>
          {work.state === "running" && (
            <motion.div key="running" {...swap}>
              <LiveSteps work={work} />
            </motion.div>
          )}
          {work.state === "needs_you" && (
            <motion.div key="needs" {...swap}>
              <p className="text-[13.5px] text-muted-foreground">
                Wants to {work.ask?.toLowerCase()}. A person still merges.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => approve(work.id)}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    openCanvas({ kind: "work", workId, tab: "preview" })
                  }
                >
                  See it working
                </Button>
                {work.replies.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      openCanvas({ kind: "work", workId, tab: "chat" })
                    }
                    className="ml-auto flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground"
                  >
                    <span className="flex -space-x-1.5">
                      {work.replies.map(
                        (reply) =>
                          reply.author && (
                            <PersonAvatar
                              key={reply.id}
                              person={reply.author}
                              className="size-5 ring-2 ring-background"
                            />
                          )
                      )}
                    </span>
                    {work.replies.length} replies
                  </button>
                )}
              </div>
            </motion.div>
          )}
          {work.state === "done" && (
            <motion.p
              key="done"
              {...swap}
              className="text-[13.5px] text-muted-foreground"
            >
              {work.result}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function GroupRow({ work }: { work: Work }) {
  const { openCanvas } = useProto()
  const shown = useLiveSteps(work)
  const live = work.steps[shown - 1]
  return (
    <button
      type="button"
      onClick={() => openCanvas({ kind: "work", workId: work.id })}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-foreground/[0.04]",
        PRESS
      )}
    >
      <StateIcon state={work.state} />
      <span className="shrink-0 text-[14px] font-medium">{work.title}</span>
      {work.repo && work.repo !== work.title && (
        <span className="shrink-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {work.repo}
        </span>
      )}
      <span
        className={cn(
          "ml-auto min-w-0 truncate text-[13px] text-muted-foreground",
          work.state === "running" && "shimmer"
        )}
      >
        {work.state === "running"
          ? live
          : work.state === "needs_you"
            ? "Needs you"
            : work.result}
      </span>
    </button>
  )
}

function GroupCard({ title, workIds }: { title: string; workIds: string[] }) {
  const { works } = useProto()
  const group = workIds.flatMap((id) => works[id] ?? [])
  const done = group.filter((work) => work.state === "done").length
  return (
    <div className={CARD}>
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-1.5">
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
          {title}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {done} of {group.length} done
        </span>
      </div>
      <div className="px-2 pb-2">
        {group.map((work) => (
          <GroupRow key={work.id} work={work} />
        ))}
      </div>
    </div>
  )
}

function StatsBlock({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className={cn(CARD, "grid grid-cols-3 divide-x divide-border/60")}>
      {items.map((item) => (
        <div key={item.label} className="px-4 py-3.5">
          <div className="text-[22px] font-semibold tracking-tight tabular-nums">
            {item.value}
          </div>
          <div className="text-[13px] text-muted-foreground">{item.label}</div>
        </div>
      ))}
    </div>
  )
}

export function Bars({ chart, tall }: { chart: Chart; tall?: boolean }) {
  const max = Math.max(...chart.bars.map((bar) => bar.value))
  return (
    <div className={cn("flex gap-2", tall ? "h-52" : "h-28")}>
      {chart.bars.map((bar, index) => (
        <div
          key={bar.label}
          className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
        >
          <div className="flex w-full flex-1 items-end justify-center">
            <motion.div
              initial={{ opacity: 0, transform: "scaleY(0.3)" }}
              animate={{ opacity: 1, transform: "scaleY(1)" }}
              transition={{
                duration: 0.4,
                delay: index * 0.04,
                ease: EASE_OUT,
              }}
              style={{
                height: `${(bar.value / max) * 100}%`,
                transformOrigin: "bottom",
              }}
              title={`${bar.label}: ${bar.value}`}
              className={cn(
                "w-full max-w-8 rounded-md",
                bar.mark ? "bg-agent" : "bg-foreground/15"
              )}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">{bar.label}</span>
        </div>
      ))}
    </div>
  )
}

export function Spark({ chart }: { chart: Chart }) {
  const max = Math.max(...chart.bars.map((bar) => bar.value))
  return (
    <span className="flex h-9 w-32 shrink-0 items-end gap-1">
      {chart.bars.map((bar) => (
        <span
          key={bar.label}
          style={{ height: `${Math.max(12, (bar.value / max) * 100)}%` }}
          className={cn(
            "flex-1 rounded-[3px]",
            bar.mark ? "bg-agent" : "bg-foreground/15"
          )}
        />
      ))}
    </span>
  )
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
        PRESS
      )}
    >
      {children}
    </button>
  )
}

function ChartCard({ chartId, agent }: { chartId: string; agent: Agent }) {
  const { openCanvas, togglePin, pins } = useProto()
  const chart = charts.find((item) => item.id === chartId)
  if (!chart) return null
  const pinned = (pins[agent.id] ?? []).includes(chart.id)
  return (
    <div className={CARD}>
      <div className="flex items-start gap-1 px-4 pt-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-muted-foreground">{chart.title}</div>
          <div className="mt-0.5 flex items-baseline gap-2.5">
            <span className="text-[26px] font-semibold tracking-tight tabular-nums">
              {chart.total}
            </span>
            <span className="text-[13px] text-success">{chart.delta}</span>
          </div>
        </div>
        <IconAction
          label={pinned ? "Unpin" : `Pin to ${agent.name}`}
          onClick={() => togglePin(agent.id, chart.id)}
        >
          <HugeiconsIcon
            icon={pinned ? PinOffIcon : Pin02Icon}
            className="size-4"
            strokeWidth={2}
          />
        </IconAction>
        <IconAction
          label="Open"
          onClick={() => openCanvas({ kind: "chart", chartId: chart.id })}
        >
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            className="size-4"
            strokeWidth={2}
          />
        </IconAction>
      </div>
      <div className="px-4 pt-4 pb-3">
        <Bars chart={chart} />
      </div>
      <p className="border-t border-border/60 px-4 py-3 text-[13.5px] leading-5 text-muted-foreground">
        {chart.note}
      </p>
    </div>
  )
}

function LeadsCard() {
  const { draftOutreach } = useProto()
  const chatId = useChatId()
  const [picked, setPicked] = useState(
    () => new Set(["lumen", "kestrel", "paygrove"])
  )
  const [sent, setSent] = useState(false)

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className={CARD}>
      <div className="px-2 pt-2">
        {leads.map((lead) => {
          const checked = picked.has(lead.id)
          return (
            <label
              key={lead.id}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-2 py-2",
                sent
                  ? "cursor-default"
                  : "cursor-pointer hover:bg-foreground/[0.04]"
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={sent}
                onChange={() => toggle(lead.id)}
                className="sr-only"
              />
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150",
                  checked
                    ? "border-foreground bg-foreground text-background"
                    : "border-muted-foreground/40"
                )}
              >
                {checked && (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    className="size-3"
                    strokeWidth={3}
                  />
                )}
              </span>
              <span className="text-[14px] font-medium">{lead.company}</span>
              <span className="text-[13px] text-muted-foreground">
                {lead.size}
              </span>
              <span className="ml-auto hidden truncate text-[13px] text-muted-foreground sm:block">
                {lead.why}
              </span>
            </label>
          )
        })}
      </div>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <Button
          size="sm"
          disabled={sent || picked.size === 0}
          onClick={() => {
            if (!chatId) return
            setSent(true)
            draftOutreach(chatId, [...picked])
          }}
        >
          {sent ? "Drafting" : `Draft outreach for ${picked.size}`}
        </Button>
        <span className="text-[13px] text-muted-foreground">
          Nothing is sent without your approval.
        </span>
      </div>
    </div>
  )
}

function DraftCard({ draftId }: { draftId: string }) {
  const { drafts, sendDraft, openCanvas } = useProto()
  const draft = drafts[draftId]
  if (!draft) return null
  return (
    <div
      id={`draft-${draft.id}`}
      className={cn(
        CARD,
        "scroll-mt-20 transition-colors duration-200",
        !draft.sent && "border-warning/45"
      )}
    >
      <div className="px-4 pt-3.5">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <HugeiconsIcon icon={Mail01Icon} className="size-4" strokeWidth={2} />
          To {draft.to}
        </div>
        <div className="mt-1.5 text-[15px] font-medium">{draft.subject}</div>
        <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-[14px] leading-6 text-foreground/80">
          {draft.body}
        </p>
      </div>
      <div className="px-4 py-3.5">
        <AnimatePresence mode="wait" initial={false}>
          {draft.sent ? (
            <motion.div
              key="sent"
              {...swap}
              className="flex items-center gap-2.5 text-[13.5px] text-muted-foreground"
            >
              <StateIcon state="done" />
              Sent to {draft.to}
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              {...swap}
              className="flex items-center gap-2"
            >
              <Button size="sm" onClick={() => sendDraft(draft.id)}>
                Send reply
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openCanvas({ kind: "draft", draftId })}
              >
                Edit
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function TemplatesBlock({ agent }: { agent: Agent }) {
  const { send, configured } = useProto()
  const chatId = useChatId()
  if (configured[agent.id] || !chatId) return null
  return (
    <div className="flex flex-col items-start gap-2">
      {templates.map((template) => (
        <button
          key={template}
          type="button"
          onClick={() => send(chatId, template)}
          className={cn(
            "cursor-pointer rounded-full border border-border px-3.5 py-1.5 text-left text-[14px] hover:bg-foreground/[0.04]",
            PRESS
          )}
        >
          {template}
        </button>
      ))}
    </div>
  )
}

const proposal = [
  { label: "Watch", value: "New Figma files and comments" },
  { label: "Tools", value: "Figma (read), Linear, Notion" },
  { label: "Ask first", value: "Before commenting in Figma" },
  { label: "People", value: "Everyone at Northstar" },
]

function ProposalCard({ agent }: { agent: Agent }) {
  const { configured, approveSetup } = useProto()
  const chatId = useChatId()
  const done = configured[agent.id]
  return (
    <div className={cn(CARD, !done && "border-warning/45")}>
      <dl className="grid grid-cols-[88px_1fr] gap-x-4 gap-y-2 px-4 pt-3.5 text-[14px]">
        {proposal.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="px-4 py-3.5">
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div
              key="done"
              {...swap}
              className="flex items-center gap-2.5 text-[13.5px] text-muted-foreground"
            >
              <StateIcon state="done" />
              Approved by you
            </motion.div>
          ) : (
            <motion.div key="ask" {...swap} className="flex gap-2">
              <Button
                size="sm"
                onClick={() => chatId && approveSetup(agent.id, chatId)}
              >
                Approve setup
              </Button>
              <Button size="sm" variant="ghost">
                Change it
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function BlockView({ block, agent }: { block: Block; agent: Agent }) {
  switch (block.kind) {
    case "work":
      return <WorkCard workId={block.workId} />
    case "group":
      return <GroupCard title={block.title} workIds={block.workIds} />
    case "stats":
      return <StatsBlock items={block.items} />
    case "chart":
      return <ChartCard chartId={block.chartId} agent={agent} />
    case "leads":
      return <LeadsCard />
    case "draft":
      return <DraftCard draftId={block.draftId} />
    case "templates":
      return <TemplatesBlock agent={agent} />
    case "proposal":
      return <ProposalCard agent={agent} />
  }
}
