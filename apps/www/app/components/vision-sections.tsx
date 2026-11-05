import {
  CloudServerIcon,
  GitBranchIcon,
  RepeatIcon,
  SecurityCheckIcon,
  SourceCodeIcon,
  UserGroupIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { BetterStackLogo } from "@repo/ui/components/logos/betterstack"
import { GitHubLogo } from "@repo/ui/components/logos/github"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import type { ReactNode } from "react"
import {
  AutomationSession,
  TriggerCard,
} from "@/app/components/automation-preview"
import { CodeSessionPreview } from "@/app/components/code-session-preview"
import { Reveal } from "@/app/components/reveal"

function Eyebrow({
  icon,
  children,
}: {
  icon: IconSvgElement
  children: ReactNode
}) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/[0.03] py-1 ps-2.5 pe-3 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
      <HugeiconsIcon
        icon={icon}
        size={13}
        strokeWidth={2}
        className="text-agent"
      />
      {children}
    </p>
  )
}

function Glow({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute -z-10 bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--color-agent)_16%,transparent),transparent)] ${className}`}
    />
  )
}

const HEADING =
  "text-balance text-4xl font-medium leading-[1.05] tracking-[-0.04em] md:text-[56px]"

const CODE_POINTS = [
  {
    icon: CloudServerIcon,
    title: "A computer for every session",
    body: "Each session gets its own sandbox with a terminal and a browser. Nothing runs on anyone’s laptop.",
  },
  {
    icon: UserGroupIcon,
    title: "Reviewed together",
    body: "Changes, files and the running app sit beside the conversation, so anyone on the team can check the work and step in.",
  },
  {
    icon: GitBranchIcon,
    title: "Shipped by a person",
    body: "Commit and push with your own GitHub account. Fork to try another approach, or rewind to an earlier turn.",
  },
]

function CodeSessions() {
  return (
    <section
      id="vision"
      aria-labelledby="code-sessions-heading"
      className="isolate scroll-mt-8 px-5 py-20 sm:px-8 md:py-28"
    >
      <div className="mx-auto max-w-[1240px]">
        <Reveal className="grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-end lg:gap-24">
          <div>
            <Eyebrow icon={SourceCodeIcon}>Code sessions</Eyebrow>
            <h2
              id="code-sessions-heading"
              className={`mt-6 max-w-[15ch] ${HEADING}`}
            >
              See it working before anyone commits.
            </h2>
          </div>
          <p className="max-w-[44ch] text-pretty text-[17px] leading-relaxed text-muted-foreground lg:pb-2">
            Take any conversation into your repo. Lor works in its own cloud
            sandbox: it changes the code, runs your app and checks the result in
            a real browser, right next to the chat.
          </p>
        </Reveal>
        <Reveal delay={80} className="relative mt-12 md:mt-16">
          <Glow className="-inset-x-16 -top-24 bottom-1/3" />
          <CodeSessionPreview />
        </Reveal>
        <ul className="mt-14 grid gap-10 md:mt-16 md:grid-cols-3 md:gap-12">
          {CODE_POINTS.map((point, index) => (
            <li key={point.title}>
              <Reveal delay={index * 60}>
                <span className="flex size-9 items-center justify-center rounded-xl border border-foreground/10 bg-foreground/[0.03] text-foreground/80">
                  <HugeiconsIcon
                    icon={point.icon}
                    size={17}
                    strokeWidth={1.8}
                  />
                </span>
                <h3 className="mt-5 text-[17px] font-medium tracking-[-0.01em]">
                  {point.title}
                </h3>
                <p className="mt-2 max-w-[36ch] text-pretty text-[15px] leading-relaxed text-muted-foreground">
                  {point.body}
                </p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const SOURCES = [
  {
    logo: <BetterStackLogo className="size-4" />,
    event: "An alert fires",
    source: "Better Stack, by webhook",
  },
  {
    logo: <LinearLogo className="size-4" />,
    event: "An issue is created",
    source: "Linear",
  },
  {
    logo: <GitHubLogo className="size-4" />,
    event: "A pull request opens",
    source: "GitHub",
  },
  {
    logo: <HugeiconsIcon icon={RepeatIcon} size={16} strokeWidth={2} />,
    event: "Every Monday at 9:00",
    source: "Loop",
  },
]

function Automations() {
  return (
    <section
      aria-labelledby="automations-heading"
      className="isolate border-t border-foreground/[0.07] px-5 py-20 sm:px-8 md:py-28"
    >
      <div className="mx-auto grid max-w-[1240px] gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
        <Reveal className="lg:sticky lg:top-24 lg:self-start lg:pt-4">
          <Eyebrow icon={ZapIcon}>Automations</Eyebrow>
          <h2
            id="automations-heading"
            className={`mt-6 max-w-[13ch] ${HEADING}`}
          >
            Let your tools start the work.
          </h2>
          <p className="mt-7 max-w-[42ch] text-pretty text-[17px] leading-relaxed text-muted-foreground">
            Send the alerts, issues and pull requests your team already gets to
            a channel. When one comes in, Lor opens a session, looks into it
            with your tools and code, and has an answer or a fix ready when
            someone checks in.
          </p>
          <p className="mt-10 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Lor starts when
          </p>
          <ul className="mt-3 divide-y divide-foreground/[0.07] border-y border-foreground/[0.07]">
            {SOURCES.map((item) => (
              <li
                key={item.event}
                className="flex items-center gap-3.5 py-3.5 text-[15px]"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-foreground/10 bg-foreground/[0.03] text-foreground/85">
                  {item.logo}
                </span>
                <span className="min-w-0 flex-1">{item.event}</span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {item.source}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-6 flex max-w-[44ch] gap-3 text-[15px] leading-relaxed text-muted-foreground">
            <HugeiconsIcon
              icon={SecurityCheckIcon}
              size={18}
              strokeWidth={1.8}
              className="mt-0.5 shrink-0 text-foreground/70"
            />
            Every run happens in a session your team can follow, and the actions
            you choose wait for a person&rsquo;s approval.
          </p>
        </Reveal>
        <Reveal delay={80} className="relative">
          <Glow className="-inset-x-10 -top-10 -bottom-10" />
          <div className="relative z-10 lg:w-[74%]">
            <TriggerCard />
          </div>
          <div className="mt-4 lg:-mt-12 lg:ml-[12%]">
            <AutomationSession />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export function VisionSections() {
  return (
    <>
      <CodeSessions />
      <Automations />
    </>
  )
}
