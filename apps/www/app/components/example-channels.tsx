import {
  Globe02Icon,
  HashtagIcon,
  Infinity01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AttioLogo } from "@repo/ui/components/logos/attio"
import { AWSCloudWatchLogo } from "@repo/ui/components/logos/aws-cloudwatch"
import { DatadogLogo } from "@repo/ui/components/logos/datadog"
import { GitHubLogo } from "@repo/ui/components/logos/github"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import { NotionLogo } from "@repo/ui/components/logos/notion"
import type { ReactNode } from "react"
import {
  LorAvatar,
  type SessionState,
  SessionStateDot,
} from "@/app/components/mock-parts"
import { Reveal } from "@/app/components/reveal"

// One example job per audience (reference/positioning.md, "Example scenes").
// #gtm is the demo video's scene; the others show it isn't a sales tool.

type ExampleChannel = {
  name: string
  tools: ReactNode[]
  job: string
  schedule: string
  lastRun: string
  state: SessionState
}

const EXAMPLES: ExampleChannel[] = [
  {
    name: "gtm",
    tools: [
      <AttioLogo key="attio" className="size-4" />,
      <HugeiconsIcon key="web" icon={Globe02Icon} size={16} />,
    ],
    job: "Find teams that fit your buyer, check them against Attio, and draft first emails for review.",
    schedule: "Every Monday at 9:00 AM",
    lastRun: "7 new leads, drafts ready",
    state: "unread",
  },
  {
    name: "engineering",
    tools: [
      <GitHubLogo key="github" className="size-4" />,
      <DatadogLogo key="datadog" className="size-4" />,
      <AWSCloudWatchLogo key="cloudwatch" className="size-4 rounded-[3px]" />,
    ],
    job: "Check new errors every morning and link each one to the pull request that likely caused it.",
    schedule: "Every weekday at 8:00 AM",
    lastRun: "2 new errors, both from #412",
    state: "needs_you",
  },
  {
    name: "product",
    tools: [
      <LinearLogo key="linear" className="size-4" />,
      <NotionLogo key="notion" className="size-4" />,
    ],
    job: "Write a weekly digest of what shipped, what slipped, and why, from Linear and the team's notes.",
    schedule: "Every Friday at 4:00 PM",
    lastRun: "Writing this week's digest",
    state: "running",
  },
]

function ExampleCard({ example }: { example: ExampleChannel }) {
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-6 dark:bg-card/50">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-medium text-[15px]">
          <HugeiconsIcon
            icon={HashtagIcon}
            size={16}
            className="text-muted-foreground"
          />
          {example.name}
        </span>
        <span className="flex items-center gap-2 text-foreground/85">
          {example.tools}
        </span>
      </div>
      <p className="mt-6 flex-1 text-pretty text-[15px] text-foreground/75 leading-relaxed">
        {example.job}
      </p>
      <span className="mt-6 flex w-fit items-center gap-1.5 rounded-lg bg-secondary/60 px-2.5 py-1.5 font-medium text-[12.5px] text-primary">
        <HugeiconsIcon icon={Infinity01Icon} size={14} />
        {example.schedule}
      </span>
      <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-lor-border-dark/60 bg-lor-bg-dark px-3 py-2">
        <LorAvatar size="size-5" />
        <span className="flex-1 truncate text-[12.5px] text-lor-text-secondary-dark">
          {example.lastRun}
        </span>
        <SessionStateDot state={example.state} />
      </div>
    </div>
  )
}

export function ExampleChannels() {
  return (
    <section
      id="examples"
      className="relative mx-auto w-full max-w-6xl px-6 py-24"
    >
      <Reveal>
        <h2 className="max-w-2xl text-balance font-semibold text-4xl leading-[1.06] tracking-[-0.03em] md:text-[44px]">
          One channel, one job.{" "}
          <span className="text-foreground/55">Start there.</span>
        </h2>
        <p className="mt-5 max-w-xl text-pretty text-[15px] text-foreground/60 leading-relaxed">
          You don&rsquo;t have to move your team chat. Give one job to one
          channel, and let the whole team see how it goes.
        </p>
      </Reveal>
      <Reveal delay={120}>
        <div className="mt-12 grid grid-cols-1 gap-2 md:grid-cols-3">
          {EXAMPLES.map((example) => (
            <ExampleCard key={example.name} example={example} />
          ))}
        </div>
      </Reveal>
    </section>
  )
}
