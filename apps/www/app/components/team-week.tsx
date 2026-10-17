import {
  BrowserIcon,
  ChatGptIcon,
  ClaudeIcon,
  Csv01Icon,
  File01Icon,
  Folder01Icon,
  HashtagIcon,
  Infinity01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode } from "react"
import { BrowserPreviewMock } from "@/app/components/browser-preview"
import { LorMark } from "@/app/components/lor-mark"
import {
  AgentAvatar,
  ApprovalCard,
  FileCard,
  PersonAvatar,
  RAFAEL,
  Toggle,
  Turn,
  ZOE,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { Panel } from "@/app/components/proof-chapters"
import { Reveal } from "@/app/components/reveal"
import {
  type Frame,
  FrameTimeline,
  LoopRunMock,
  SessionTitle,
} from "@/app/components/week-in-gtm"

// One person's agent workflow becoming the team's: Zoe moves her setup into
// #gtm, it runs on its own in the channel's browser, it asks before sending,
// and Rafael finishes her session while she is out. Replaces WeekInGtm's
// feature tour.

const FILES = [
  { icon: Folder01Icon, name: "scripts/", detail: "4 scripts" },
  { icon: File01Icon, name: "playbook.md", detail: "Edited by Zoe" },
  { icon: Csv01Icon, name: "leads.csv", detail: "Updated Monday" },
  { icon: BrowserIcon, name: "Browser", detail: "Signed in to Attio" },
]

const AGENTS: { name: string; detail: string; icon: ReactNode }[] = [
  {
    name: "Claude Code",
    detail: "Zoe's subscription",
    icon: <HugeiconsIcon icon={ClaudeIcon} size={15} />,
  },
  {
    name: "Codex",
    detail: "Theo's subscription",
    icon: <HugeiconsIcon icon={ChatGptIcon} size={15} />,
  },
  { name: "Lor", detail: "Built in", icon: <LorMark className="size-3.5" /> },
]

function PanelRow({
  icon,
  name,
  detail,
  aside,
}: {
  icon: ReactNode
  name: string
  detail: string
  aside?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 border-lor-border-dark/50 border-t py-2 first:border-t-0">
      <span className="flex size-4 items-center justify-center text-lor-text-secondary-dark">
        {icon}
      </span>
      <span className="flex-1 truncate text-[13px] text-lor-text-dark">
        {name}
      </span>
      <span className="text-[12px] text-lor-text-tertiary-dark">{detail}</span>
      {aside}
    </div>
  )
}

function ChannelComputerMock() {
  return (
    <MockShell>
      <div aria-hidden className="flex flex-col gap-2.5 p-4 text-left md:p-5">
        <Panel>
          <p className="flex items-center justify-between text-[12px] text-lor-text-tertiary-dark">
            <span className="font-medium text-lor-text-dark">
              #gtm computer
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-lor-success-dark" />
              Always on
            </span>
          </p>
          <p className="mt-1 font-mono text-[11px] text-lor-text-tertiary-dark">
            ~/gtm · moved from Zoe&rsquo;s laptop
          </p>
          <div className="mt-2 flex flex-col">
            {FILES.map((file) => (
              <PanelRow
                key={file.name}
                icon={<HugeiconsIcon icon={file.icon} size={15} />}
                name={file.name}
                detail={file.detail}
              />
            ))}
          </div>
        </Panel>
        <Panel>
          <p className="font-medium text-[12px] text-lor-text-dark">
            Agents in #gtm
          </p>
          <div className="mt-2 flex flex-col">
            {AGENTS.map((agent) => (
              <PanelRow
                key={agent.name}
                icon={agent.icon}
                name={agent.name}
                detail={agent.detail}
                aside={<Toggle on />}
              />
            ))}
          </div>
        </Panel>
      </div>
    </MockShell>
  )
}

function SendApprovalMock() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-5 pb-5 text-left md:px-6">
        <SessionTitle
          title="Weekly lead research"
          meta={
            <>
              <HugeiconsIcon icon={HashtagIcon} size={12} />
              gtm
              <span className="px-0.5 opacity-60">·</span>
              <HugeiconsIcon icon={Infinity01Icon} size={12} />
              Every Monday at 9:00 AM
            </>
          }
          faces={[ZOE]}
        />
        <Turn avatar={<AgentAvatar />}>
          12 intro drafts are ready to go.
          <ApprovalCard
            title="Send 12 intro emails from zoe@kestrel.com"
            tool="send_email"
          />
        </Turn>
      </div>
    </MockShell>
  )
}

function RafaelPicksUpMock() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-5 pb-5 text-left md:px-6">
        <SessionTitle
          title="Paygrove follow-up"
          meta={
            <>
              <HugeiconsIcon icon={HashtagIcon} size={12} />
              gtm · Started by Zoe
            </>
          }
          faces={[ZOE, RAFAEL]}
        />
        <Turn avatar={<PersonAvatar src={ZOE} />}>
          Start the Paygrove follow-up. They asked about annual billing.
          I&rsquo;ll finish it later.
        </Turn>
        <Turn avatar={<AgentAvatar />}>
          First pass is in paygrove-follow-up.md. I left the annual price blank.
        </Turn>
        <p className="mt-5 flex items-center gap-3 text-[11px] text-lor-text-tertiary-dark">
          <span className="h-px flex-1 bg-lor-border-dark/60" />
          Thursday
          <span className="h-px flex-1 bg-lor-border-dark/60" />
        </p>
        <Turn avatar={<PersonAvatar src={RAFAEL} />}>
          Zoe&rsquo;s out today. Annual is $32 a seat. Can you finish it?
        </Turn>
        <Turn avatar={<AgentAvatar />}>
          Done. I kept Zoe&rsquo;s opening and filled in the price.
          <FileCard name="paygrove-follow-up.md" detail="Ready to send" />
        </Turn>
      </div>
    </MockShell>
  )
}

const FRAMES: Frame[] = [
  {
    time: "Friday, 4:12 PM",
    title: "Zoe moves her setup off her laptop.",
    mock: <ChannelComputerMock />,
  },
  {
    time: "Monday, 9:00 AM",
    title: "The Monday run starts without her.",
    mock: <LoopRunMock />,
  },
  {
    time: "Monday, 9:06 AM",
    title: "Anyone can watch it work, or take over.",
    mock: <BrowserPreviewMock />,
  },
  {
    time: "Monday, 9:14 AM",
    title: "Nothing goes out until Zoe says so.",
    mock: <SendApprovalMock />,
  },
  {
    time: "Thursday, 2:40 PM",
    title: "Zoe is out. Rafael finishes what she started.",
    mock: <RafaelPicksUpMock />,
  },
]

export function TeamWeek() {
  return (
    <section
      id="week"
      className="relative mx-auto w-full max-w-6xl scroll-mt-16 px-6 py-24"
    >
      <Reveal>
        <h2 className="font-semibold text-3xl leading-[1.08] tracking-[-0.03em] md:text-[40px]">
          A week in #gtm.
        </h2>
      </Reveal>
      <FrameTimeline frames={FRAMES} />
    </section>
  )
}
