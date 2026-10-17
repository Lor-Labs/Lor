import { FileTypeIcon } from "@repo/ui/components/file-type-icon"
import { AttioLogo } from "@repo/ui/components/logos/attio"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import type { ReactNode } from "react"
import {
  AgentAvatar,
  AgentName,
  PersonAvatar,
  RAFAEL,
  THEO,
  Turn,
  ZOE,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { Reveal } from "@/app/components/reveal"

// The context engine, shown (reference/planned/context-engine.md): one deal
// linked to the sessions, issue and file that touched it, then an agent
// answering from those links. On phones the nodes stack and the lines hide.

type LinkedNode = {
  relation: string
  icon: ReactNode
  title: string
  detail: string
  // Cell in the 3 × 3 desktop grid; the deal sits in the middle.
  cell: string
}

const NODES: LinkedNode[] = [
  {
    relation: "Discussed in",
    icon: <PersonAvatar src={ZOE} size="size-4" />,
    title: "Paygrove intro call",
    detail: "Zoe's session · Tuesday",
    cell: "md:col-start-1 md:row-start-1",
  },
  {
    relation: "Same question as",
    icon: <PersonAvatar src={THEO} size="size-4" />,
    title: "Ledgerline renewal",
    detail: "Theo's session · 2 weeks ago",
    cell: "md:col-start-2 md:row-start-1",
  },
  {
    relation: "Filed as",
    icon: <LinearLogo className="size-3.5" />,
    title: "Annual billing for small teams",
    detail: "Linear issue",
    cell: "md:col-start-3 md:row-start-1",
  },
  {
    relation: "Priced in",
    icon: <PersonAvatar src={RAFAEL} size="size-4" />,
    title: "Annual pricing",
    detail: "Rafael's session · $32 a seat",
    cell: "md:col-start-1 md:row-start-3",
  },
  {
    relation: "Follow-up",
    icon: <FileTypeIcon filename="paygrove-follow-up.md" className="size-4" />,
    title: "paygrove-follow-up.md",
    detail: "Ready to send",
    cell: "md:col-start-3 md:row-start-3",
  },
]

// Line ends at the desktop cell centers, in a 0–100 box.
const LINE_ENDS = [
  [16.7, 16.7],
  [50, 16.7],
  [83.3, 16.7],
  [16.7, 83.3],
  [83.3, 83.3],
]

function Node({ node }: { node: LinkedNode }) {
  return (
    <div className={`relative flex items-center justify-center ${node.cell}`}>
      <div className="w-full rounded-xl border border-lor-border-dark bg-lor-surface-dark px-3 py-2.5 md:max-w-[220px]">
        <p className="text-[10.5px] text-agent">{node.relation}</p>
        <p className="mt-1 flex items-center gap-2 font-medium text-[12.5px] text-lor-text-dark">
          <span className="flex size-4 shrink-0 items-center justify-center">
            {node.icon}
          </span>
          <span className="truncate">{node.title}</span>
        </p>
        <p className="mt-0.5 truncate pl-6 text-[11px] text-lor-text-tertiary-dark">
          {node.detail}
        </p>
      </div>
    </div>
  )
}

function Graph() {
  return (
    <div className="relative grid grid-cols-1 gap-2.5 md:h-[340px] md:grid-cols-3 md:grid-rows-3 md:gap-4">
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 hidden size-full md:block"
      >
        {LINE_ENDS.map(([x, y]) => (
          <line
            key={`${x}-${y}`}
            x1={50}
            y1={50}
            x2={x}
            y2={y}
            vectorEffect="non-scaling-stroke"
            strokeDasharray="3 4"
            className="stroke-agent/45"
            strokeWidth={1.25}
          />
        ))}
      </svg>
      <div className="relative flex items-center justify-center md:col-start-2 md:row-start-2">
        <div className="w-full rounded-xl border border-agent/50 bg-lor-surface-raised-dark px-3.5 py-3 shadow-[0_0_40px_-12px_var(--color-agent)] md:max-w-[200px]">
          <p className="flex items-center gap-2 font-semibold text-[14px] text-lor-text-dark">
            <AttioLogo className="size-4 text-lor-text-dark" />
            Paygrove
          </p>
          <p className="mt-0.5 pl-6 text-[11.5px] text-lor-text-tertiary-dark">
            Deal in Attio · Negotiation
          </p>
        </div>
      </div>
      {NODES.map((node) => (
        <Node key={node.title} node={node} />
      ))}
    </div>
  )
}

export function ContextGraph() {
  return (
    <section
      id="connects"
      className="relative mx-auto w-full max-w-6xl scroll-mt-16 px-6 py-24"
    >
      <Reveal>
        <h2 className="max-w-[20ch] text-balance font-semibold text-3xl leading-[1.08] tracking-[-0.03em] md:text-[40px]">
          Lor sees how it all connects.
        </h2>
        <p className="mt-4 max-w-xl text-pretty text-[16px] text-muted-foreground leading-relaxed">
          Every session, call, deal, issue and file is linked, so any agent can
          follow the thread.
        </p>
      </Reveal>
      <Reveal delay={120}>
        <div className="mt-12">
          <MockShell>
            <div aria-hidden className="p-4 text-left md:p-8">
              <Graph />
              <div className="mx-auto mt-6 max-w-xl border-lor-border-dark/60 border-t pt-2 md:mt-8">
                <Turn avatar={<PersonAvatar src={THEO} />} name="Theo">
                  Anything I should know before the Paygrove call?
                </Turn>
                <Turn
                  avatar={<AgentAvatar agent="codex" />}
                  name={<AgentName agent="codex" />}
                >
                  They want annual billing. Rafael already priced it at $32 a
                  seat, Ledgerline asked for the same thing, and it&rsquo;s
                  filed in Linear. Zoe&rsquo;s follow-up is ready to send.
                </Turn>
              </div>
            </div>
          </MockShell>
        </div>
      </Reveal>
    </section>
  )
}
