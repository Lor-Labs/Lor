import {
  ArrowTurnForwardIcon,
  HashtagIcon,
  Infinity01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AttioLogo } from "@repo/ui/components/logos/attio"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import type { ReactNode } from "react"
import {
  ApprovalCard,
  ChatLine,
  Citation,
  FileCard,
  LorAvatar,
  PersonAvatar,
  RAFAEL,
  SessionStateDot,
  THEO,
  ToolStep,
  Turn,
  WorkLog,
  ZOE,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { SetupMock } from "@/app/components/proof-chapters"
import { Reveal } from "@/app/components/reveal"

// One week of #gtm told in product frames: a time, what happened, and the
// screen. Replaces the claim-per-chapter sections (proof-chapters.tsx).

export function SessionTitle({
  title,
  meta,
  faces,
}: {
  title: string
  meta: ReactNode
  faces?: string[]
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="font-semibold text-[17px] text-lor-text-dark leading-tight">
          {title}
        </p>
        <p className="mt-1 flex items-center gap-1 text-[12px] text-lor-text-tertiary-dark">
          {meta}
        </p>
      </div>
      {faces ? (
        <span className="-space-x-1 flex">
          {faces.map((face) => (
            <PersonAvatar
              key={face}
              src={face}
              size="size-5"
              className="ring-2 ring-lor-bg-dark"
            />
          ))}
        </span>
      ) : null}
    </div>
  )
}

const RUNS = [
  { date: "Oct 13", result: "Researching leads", running: true },
  { date: "Oct 6", result: "5 new leads, 5 drafts", running: false },
  { date: "Sep 29", result: "9 new leads, 9 drafts", running: false },
]

export function LoopRunMock() {
  return (
    <MockShell>
      <div aria-hidden className="flex flex-col gap-4 p-5 text-left md:p-6">
        <span className="flex w-fit items-center gap-2 rounded-xl bg-secondary/60 px-4 py-2.5 text-[13px]">
          <HugeiconsIcon
            icon={Infinity01Icon}
            size={15}
            className="text-primary"
          />
          <span className="font-medium text-primary">
            Every Monday at 9:00 AM
          </span>
          <span className="text-lor-text-tertiary-dark/60">·</span>
          <span className="font-medium text-lor-text-dark">
            Weekly lead research
          </span>
        </span>
        <div className="flex flex-col">
          {RUNS.map((run) => (
            <div
              key={run.date}
              className="flex items-center gap-3 border-lor-border-dark/50 border-t py-2 text-[12.5px] first:border-t-0"
            >
              <span className="w-14 text-lor-text-tertiary-dark tabular-nums">
                {run.date}
              </span>
              <span className="flex-1 text-lor-text-secondary-dark">
                {run.result}
              </span>
              {run.running ? (
                <SessionStateDot state="running" />
              ) : (
                <HugeiconsIcon
                  icon={Tick02Icon}
                  size={14}
                  className="text-lor-success-dark"
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </MockShell>
  )
}

function ForwardMock() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-3 pb-5 text-left">
        <p className="flex items-center gap-1 pt-1 font-semibold text-[13.5px] text-lor-text-dark">
          <HugeiconsIcon
            icon={HashtagIcon}
            size={14}
            className="text-lor-text-tertiary-dark"
          />
          gtm
        </p>
        <ChatLine avatar={ZOE} name="Zoe" time="10:31 AM">
          This week&rsquo;s list. I checked every draft.
          <div className="mt-1.5 border-lor-border-dark border-l-2 py-0.5 pl-3">
            <p className="flex items-center gap-1 text-[11px] text-lor-text-tertiary-dark italic">
              <HugeiconsIcon icon={ArrowTurnForwardIcon} size={13} />
              Forwarded
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 font-medium text-[12px] text-lor-text-dark">
              <LorAvatar size="size-4" />
              Lor
            </p>
            <p className="mt-1">
              12 teams found. 5 are already in Attio, so I skipped them. Drafts
              for the other 7 are in outreach-drafts.md.
            </p>
            <p className="mt-1.5 text-[11px] text-lor-text-tertiary-dark">
              #gtm › Weekly lead research · Oct 13, 9:12 AM
            </p>
          </div>
        </ChatLine>
        <ChatLine avatar={THEO} name="Theo" time="10:34 AM">
          Taking Ledgerline and Tillwise.
        </ChatLine>
        <ChatLine avatar={RAFAEL} name="Rafael" time="10:36 AM">
          I&rsquo;ve got Paygrove.
        </ChatLine>
      </div>
    </MockShell>
  )
}

function TriggerMock() {
  return (
    <MockShell>
      <div aria-hidden className="p-5 text-left">
        <div className="flex items-center gap-2.5 rounded-xl border border-lor-border-dark/70 bg-lor-surface-dark px-3.5 py-2.5 text-[12.5px]">
          <AttioLogo className="size-4 text-lor-text-dark" />
          <span className="font-medium text-lor-text-dark">
            Call recording ready
          </span>
          <span className="truncate text-lor-text-tertiary-dark">
            Paygrove intro call · 32 min
          </span>
        </div>
        <div className="ml-[23px] h-5 w-px bg-lor-border-dark" />
        <SessionTitle
          title="Follow-up: Paygrove intro call"
          meta={
            <>
              <HugeiconsIcon icon={HashtagIcon} size={12} />
              gtm · Started by an automation
            </>
          }
        />
        <Turn avatar={<LorAvatar />}>
          <WorkLog label="Worked" detail="read the call transcript" />
          <p className="mt-2">
            Drafted the follow-up. It answers their annual billing question and
            offers the 30-day pilot Rafael mentioned.
          </p>
          <FileCard name="paygrove-follow-up.md" detail="Draft" />
        </Turn>
      </div>
    </MockShell>
  )
}

function RecallMock() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-1 pb-5 text-left md:px-6">
        <Turn avatar={<PersonAvatar src={THEO} />}>
          What did Paygrove push back on yesterday?
        </Turn>
        <Turn avatar={<LorAvatar />}>
          <p>
            Price. Their founder said $40 a seat is a lot for a team of 12 and
            asked about annual billing.
            <Citation>Paygrove intro call</Citation>
          </p>
          <p className="mt-2">
            Ledgerline asked the same thing two weeks ago.
            <Citation>message</Citation>
          </p>
        </Turn>
      </div>
    </MockShell>
  )
}

function ApprovalMock() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-5 pb-5 text-left md:px-6">
        <SessionTitle
          title="Annual billing requests"
          meta={
            <>
              <HugeiconsIcon icon={HashtagIcon} size={12} />
              gtm · Started by Theo
            </>
          }
          faces={[THEO, ZOE]}
        />
        <Turn avatar={<LorAvatar />}>
          <WorkLog label="Worked" detail="4 tool calls" open>
            <ToolStep
              icon={<AttioLogo className="size-3 text-lor-text-dark" />}
              label="Found 3 deals that asked for annual billing"
            />
            <ToolStep
              icon={<LinearLogo className="size-3" />}
              label="Searched Linear for an existing issue"
            />
          </WorkLog>
          <p className="mt-2">
            Paygrove, Ledgerline, and Tillwise asked this month. Nobody has
            filed it yet.
          </p>
          <ApprovalCard
            title="Create a Linear issue: Annual billing for small teams"
            tool="create_linear_issue"
          />
        </Turn>
      </div>
    </MockShell>
  )
}

export type Frame = {
  id?: string
  time: string
  title: string
  mock: ReactNode
}

// Ids keep the header and footer anchors working.
const FRAMES: Frame[] = [
  {
    id: "integrations",
    time: "Friday, 4:12 PM",
    title: "Zoe sets up #gtm.",
    mock: <SetupMock />,
  },
  {
    id: "loops",
    time: "Monday, 9:00 AM",
    title: "The weekly run starts on its own.",
    mock: <LoopRunMock />,
  },
  {
    time: "Monday, 10:31 AM",
    title: "Zoe shares the list with the team.",
    mock: <ForwardMock />,
  },
  {
    time: "Tuesday, 3:02 PM",
    title: "A call recording lands in Attio.",
    mock: <TriggerMock />,
  },
  {
    id: "memory",
    time: "Wednesday, 10:20 AM",
    title: "Theo asks what came up on the call.",
    mock: <RecallMock />,
  },
  {
    id: "control",
    time: "Thursday, 11:40 AM",
    title: "Lor asks before it files a ticket.",
    mock: <ApprovalMock />,
  },
]

export function WeekInGtm() {
  return (
    <section id="week" className="relative mx-auto w-full max-w-6xl px-6 py-24">
      <Reveal>
        <h2 className="font-semibold text-3xl leading-[1.08] tracking-[-0.03em] md:text-[40px]">
          A week in #gtm.
        </h2>
      </Reveal>
      <FrameTimeline frames={FRAMES} />
    </section>
  )
}

export function FrameTimeline({ frames }: { frames: Frame[] }) {
  return (
    <ol className="relative mt-16">
      <span
        aria-hidden
        className="absolute top-2 bottom-0 left-[4px] w-px bg-gradient-to-b from-foreground/15 via-foreground/10 to-transparent"
      />
      {frames.map((frame) => (
        <li
          key={frame.time}
          id={frame.id}
          className="relative grid scroll-mt-28 grid-cols-1 gap-6 pb-20 pl-8 last:pb-0 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-12"
        >
          <span
            aria-hidden
            className="absolute top-[7px] left-0 size-[9px] rounded-full bg-agent ring-4 ring-background"
          />
          <Reveal>
            <div className="md:sticky md:top-32">
              <p className="text-[13px] text-muted-foreground tabular-nums">
                {frame.time}
              </p>
              <h3 className="mt-1.5 text-balance font-semibold text-xl leading-snug tracking-[-0.02em] md:text-2xl">
                {frame.title}
              </h3>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="max-w-2xl">{frame.mock}</div>
          </Reveal>
        </li>
      ))}
    </ol>
  )
}
