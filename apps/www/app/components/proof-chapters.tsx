import {
  Globe02Icon,
  HashtagIcon,
  Infinity01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AttioLogo } from "@repo/ui/components/logos/attio"
import { DatadogLogo } from "@repo/ui/components/logos/datadog"
import { GitHubLogo } from "@repo/ui/components/logos/github"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import { NotionLogo } from "@repo/ui/components/logos/notion"
import { features } from "@repo/utils/features"
import type { ReactNode } from "react"
import { Chapter } from "@/app/components/chapter"
import {
  ApprovalCard,
  Citation,
  LorAvatar,
  PersonAvatar,
  RAFAEL,
  SessionStateDot,
  Toggle,
  ToolStep,
  Turn,
  WorkLog,
  ZOE,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { Reveal } from "@/app/components/reveal"

// The problem, then one chapter per proof point (reference/positioning.md).
// The scenes continue the hero's #gtm story.

export function ProblemSection() {
  return (
    <section
      id="why"
      className="relative mx-auto w-full max-w-6xl px-6 py-24 md:py-32"
    >
      <Reveal>
        <div className="mx-auto max-w-2xl">
          <h2 className="text-balance font-semibold text-4xl leading-[1.06] tracking-[-0.03em] md:text-[44px]">
            Your team already works with AI.{" "}
            <span className="text-foreground/55">Each person, alone.</span>
          </h2>
          <div className="mt-8 flex flex-col gap-5 text-[16.5px] text-foreground/70 leading-[1.7]">
            <p>
              Everyone has their own chat tab. Good results reach the team as
              pasted text or a screenshot, and the reasoning stays behind. The
              next person builds the same context from scratch. When someone
              leaves, their chats leave with them.
            </p>
            <p>
              Lor moves that work into the channel. The team sets up the agent
              once, everyone sees what it does, and anyone can step in.
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-lor-border-dark/70 bg-lor-surface-dark p-4">
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Set it up once: LOR.md plus the channel's agent profile
// ---------------------------------------------------------------------------

const PROFILE_TOOLS = [
  { name: "Attio", on: true, icon: <AttioLogo className="size-4" /> },
  {
    name: "Web search",
    on: true,
    icon: <HugeiconsIcon icon={Globe02Icon} size={16} />,
  },
  { name: "Notion", on: true, icon: <NotionLogo className="size-4" /> },
  { name: "GitHub", on: false, icon: <GitHubLogo className="size-4" /> },
  { name: "Linear", on: true, icon: <LinearLogo className="size-4" /> },
]

export function SetupMock() {
  return (
    <MockShell>
      <div aria-hidden className="flex flex-col gap-2.5 p-4 text-left md:p-5">
        <Panel>
          <p className="flex items-center justify-between text-[12px] text-lor-text-tertiary-dark">
            <span className="font-medium text-lor-text-dark">LOR.md</span>
            Edited by Zoe
          </p>
          <div className="mt-2.5 flex flex-col gap-1 font-mono text-[11.5px] text-lor-text-secondary-dark leading-relaxed">
            <p>Our buyers are seed to Series A fintech teams.</p>
            <p>Keep first emails under 100 words.</p>
            <p>Lor drafts. A person sends.</p>
          </div>
        </Panel>
        <Panel>
          <p className="flex items-center gap-1 text-[12px] text-lor-text-tertiary-dark">
            <HugeiconsIcon icon={HashtagIcon} size={13} />
            <span className="font-medium text-lor-text-dark">gtm</span>
            uses the Outbound profile
          </p>
          <div className="mt-2 flex flex-col">
            {PROFILE_TOOLS.map((tool) => (
              <div
                key={tool.name}
                className="flex items-center gap-3 border-lor-border-dark/50 border-t py-2 text-lor-text-dark first:border-t-0"
              >
                <span className="flex size-4 items-center justify-center">
                  {tool.icon}
                </span>
                <span
                  className={`flex-1 text-[13px] ${
                    tool.on ? "" : "text-lor-text-tertiary-dark"
                  }`}
                >
                  {tool.name}
                </span>
                <Toggle on={tool.on} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </MockShell>
  )
}

export function SetupChapter() {
  return (
    <Chapter
      id="integrations"
      title="Set it up once."
      titleMuted="Everyone gets the same agent."
      mock={<SetupMock />}
      points={[
        {
          lead: "Tell it how your team works.",
          body: "Write your playbook once in LOR.md. Every session follows it, so nobody explains the buyer or the tone again.",
        },
        {
          lead: "Give each channel its tools.",
          body: "Connect Attio, GitHub, Linear, Notion, Datadog, CloudWatch, or any MCP server. Then choose what each channel's agent can use.",
        },
        {
          lead: "Ready for every teammate.",
          body: "When anyone starts a session in #gtm, Lor already has the playbook and the tools. Nothing to copy, nothing to paste.",
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// It knows what your team knows: an answer cited from a call and the chat
// ---------------------------------------------------------------------------

function MemoryMock() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-1 pb-5 text-left md:px-6">
        <Turn avatar={<PersonAvatar src={ZOE} />}>
          {features.voiceChannels
            ? "What did Paygrove push back on in last week’s call?"
            : "What did Paygrove push back on in last week’s discussion?"}
        </Turn>
        <Turn avatar={<LorAvatar />}>
          <WorkLog
            label="Worked"
            detail={
              features.voiceChannels
                ? "searched calls, chat, and Attio"
                : "searched chat, sessions, and Attio"
            }
          />
          <p className="mt-2">
            Price. Their founder said $40 a seat is a lot for a team of 12 and
            asked about annual billing.
            <Citation>
              {features.voiceChannels
                ? "#gtm call · 14:32"
                : "#customers thread"}
            </Citation>
          </p>
          <p className="mt-2">
            Rafael offered a 30-day pilot in the follow-up thread.
            <Citation>message</Citation> Attio still lists the deal as open.
            <Citation>Paygrove</Citation>
          </p>
        </Turn>
      </div>
    </MockShell>
  )
}

export function MemoryChapter() {
  return (
    <Chapter
      id="memory"
      title="It knows"
      titleMuted="what your team knows."
      flip
      mock={<MemoryMock />}
      points={[
        {
          lead: "Context it doesn't have to ask for.",
          body: "Lor reads team chat, past sessions, and connected tools, so it starts every job with what your team already knows.",
        },
        ...(features.voiceChannels
          ? [
              {
                lead: "Calls count too.",
                body: "Voice channels are transcribed and summarized, so decisions made out loud are searchable like everything else.",
              },
            ]
          : []),
        {
          lead: "Every claim has a source.",
          body: features.voiceChannels
            ? "Answers link to the message, the moment in the call, or the record they came from. One click to check."
            : "Answers link to the message, session, or record they came from. One click to check.",
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// It keeps working: a weekly loop, its runs, and an event trigger
// ---------------------------------------------------------------------------

const RUNS = [
  { date: "Oct 13", result: "Researching leads", running: true },
  { date: "Oct 6", result: "5 new leads, 5 drafts", running: false },
  { date: "Sep 29", result: "9 new leads, 9 drafts", running: false },
]

function LoopsMock() {
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
        <div>
          <p className="font-medium text-[11.5px] text-lor-text-tertiary-dark">
            Runs
          </p>
          <div className="mt-1.5 flex flex-col">
            {RUNS.map((run) => (
              <div
                key={run.date}
                className="flex items-center gap-3 border-lor-border-dark/50 border-t py-2 text-[12.5px] first:border-t-0"
              >
                <span className="w-14 text-lor-text-tertiary-dark">
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
        <Panel>
          <p className="flex items-center gap-2 text-[12.5px] text-lor-text-dark">
            <AttioLogo className="size-4" />
            When a call recording is ready in Attio
          </p>
          <p className="mt-1 pl-6 text-[12px] text-lor-text-tertiary-dark">
            Lor starts a session in #gtm and drafts the follow-up
          </p>
        </Panel>
      </div>
    </MockShell>
  )
}

export function LoopsChapter() {
  return (
    <Chapter
      id="loops"
      title="It keeps working."
      titleMuted="Even when nobody asks."
      mock={<LoopsMock />}
      points={[
        {
          lead: "Ask once, it runs every week.",
          body: "Tell Lor to do it every Monday. It proposes a schedule, and anyone in the channel can turn it on.",
        },
        {
          lead: "Events can start it too.",
          body: "A merged pull request, a new Linear issue, or a call recording in Attio can start a session on its own.",
        },
        {
          lead: "Each run builds on the last.",
          body: "Runs land in the same session, so Lor sees last week's results before it starts this week's work.",
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// Your team stays in charge: a shared session paused on an approval
// ---------------------------------------------------------------------------

function ControlMock() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-5 pb-5 text-left md:px-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-[17px] text-lor-text-dark leading-tight">
              Checkout errors in 2.14
            </p>
            <p className="mt-1 flex items-center gap-1 text-[12px] text-lor-text-tertiary-dark">
              <HugeiconsIcon icon={HashtagIcon} size={12} />
              engineering · Started by Rafael
            </p>
          </div>
          <span className="-space-x-1.5 flex">
            <PersonAvatar
              src={RAFAEL}
              size="size-5"
              className="ring-2 ring-lor-bg-dark"
            />
            <PersonAvatar
              src={ZOE}
              size="size-5"
              className="ring-2 ring-lor-bg-dark"
            />
          </span>
        </div>
        <Turn avatar={<LorAvatar />}>
          <WorkLog label="Worked" detail="9 tool calls" open>
            <ToolStep
              icon={<DatadogLogo className="size-3.5" />}
              label="Read 312 checkout errors in Datadog"
            />
            <ToolStep
              icon={<GitHubLogo className="size-3" />}
              label="Read pull request #412"
            />
          </WorkLog>
          <p className="mt-2">
            The errors started 40 minutes after 2.14 shipped. The new retry in
            #412 holds checkout open past the 10 second timeout.
          </p>
          <ApprovalCard
            title="Create a Linear issue for the checkout timeout"
            tool="create_linear_issue"
          />
        </Turn>
      </div>
    </MockShell>
  )
}

export function ControlChapter() {
  return (
    <Chapter
      id="control"
      title="Your team"
      titleMuted="stays in charge."
      flip
      mock={<ControlMock />}
      points={[
        {
          lead: "Everyone sees the work.",
          body: "Sessions sit next to the channel chat. Anyone in the channel can open one, read what Lor did, and type in it.",
        },
        {
          lead: "Step in with a mention.",
          body: "Mention a teammate to pull them in. Lor stays quiet while people talk, then picks up their changes.",
        },
        {
          lead: "Approvals where they matter.",
          body: "Choose which actions need sign-off and who can give it. Lor waits until the right person approves.",
        },
      ]}
    />
  )
}
