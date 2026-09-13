import { AWSCloudWatchLogo } from "@repo/ui/components/logos/aws-cloudwatch"
import { DatadogLogo } from "@repo/ui/components/logos/datadog"
import { GoogleLogo } from "@repo/ui/components/logos/google"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import { NotionLogo } from "@repo/ui/components/logos/notion"
import { SentryLogo } from "@repo/ui/components/logos/sentry"
import { SlackLogo } from "@repo/ui/components/logos/slack"
import {
  ArrowRight,
  CalendarClock,
  Globe,
  Hash,
  Monitor,
  Smartphone,
  Volume2,
} from "lucide-react"
import type { ReactNode } from "react"
import { Reveal } from "@/app/components/reveal"

// ---------------------------------------------------------------------------
// Always in context
// ---------------------------------------------------------------------------

function ContextRow({
  icon,
  label,
  translate,
  bg,
}: {
  icon: ReactNode
  label: string
  translate: string
  bg: string
}) {
  return (
    <div
      className={`flex h-16 items-center rounded-xl border px-4 pt-3 shadow-xs transition-all duration-600 ease-in-out group-hover:h-12 group-hover:translate-x-0 group-hover:rounded-lg group-hover:pt-0 ${translate} ${bg}`}
    >
      <div className="flex items-center gap-2 [&_svg]:size-4">
        {icon}
        <span className="font-medium text-sm">{label}</span>
      </div>
    </div>
  )
}

function ContextCard() {
  return (
    <div className="group relative rounded-2xl border bg-card md:col-span-3 dark:bg-card/50">
      <div className="relative flex h-64 items-center justify-center overflow-hidden">
        <div className="-space-y-2 relative size-full p-4 group-hover:space-y-2">
          <ContextRow
            icon={<Hash />}
            label="#engineering"
            translate="translate-x-1/2"
            bg="bg-background bg-[radial-gradient(80%_80%_at_10%_0%,--theme(--color-foreground/.08),transparent)]"
          />
          <ContextRow
            icon={<LinearLogo className="size-4" mode="dark" />}
            label="DESIGN-204"
            translate="translate-x-1/3"
            bg="bg-background bg-[radial-gradient(25%_80%_at_10%_0%,--theme(--color-foreground/.08),transparent)]"
          />
          <ContextRow
            icon={
              <span className="flex size-4 items-center justify-center overflow-hidden rounded-[2px] bg-foreground">
                <NotionLogo className="size-4" />
              </span>
            }
            label="Q2 Launch plan"
            translate="translate-x-1/4"
            bg="bg-card"
          />
          <ContextRow
            icon={<Volume2 />}
            label="Daily Sync transcript"
            translate="translate-x-1/5"
            bg="bg-agent text-agent-foreground"
          />
        </div>
      </div>
      <div className="p-6">
        <h3 className="font-medium text-base leading-tight md:text-lg">
          <span>Always in context.</span>{" "}
          <span className="text-muted-foreground">
            Lor reads every channel, ticket, and doc automatically.
          </span>
        </h3>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Takes action
// ---------------------------------------------------------------------------

function ActionPill({
  icon,
  label,
  className = "",
}: {
  icon?: ReactNode
  label?: string
  className?: string
}) {
  return (
    <div
      className={`flex h-12 items-center gap-2 rounded-lg border bg-background px-4 shadow-xs ${className}`}
    >
      <div className="*:size-4">{icon}</div>
      {label ? (
        <span className="whitespace-nowrap font-medium text-xs">{label}</span>
      ) : null}
    </div>
  )
}

function ActionsCard() {
  return (
    <div className="group relative rounded-2xl border bg-card md:col-span-5 dark:bg-card/50">
      <div className="p-6">
        <h3 className="font-medium text-base leading-tight md:text-lg">
          <span>Takes action.</span>{" "}
          <span className="text-muted-foreground">
            Open tickets, draft messages, schedule reminders. Lor doesn't just
            answer. It acts.
          </span>
        </h3>
      </div>
      <div className="relative flex h-64 items-center justify-center overflow-hidden">
        <div className="grid size-full translate-x-1/6 grid-cols-1 gap-1 pt-2 transition-all duration-600 ease-in-out *:flex *:w-full *:gap-1 group-hover:-mt-1 group-hover:translate-x-0 group-hover:scale-98 group-hover:px-4 group-hover:pt-0">
          <div>
            <ActionPill
              icon={<LinearLogo className="size-4" mode="dark" />}
              label="Open Linear ticket"
              className="bg-[radial-gradient(80%_100%_at_20%_0%,--theme(--color-foreground/.1),transparent)]"
            />
            <ActionPill className="w-full" />
          </div>
          <div>
            <ActionPill className="w-full" />
            <ActionPill
              icon={<SlackLogo className="size-4" />}
              label="Pull Slack history"
              className="bg-[radial-gradient(80%_100%_at_50%_0%,--theme(--color-foreground/.1),transparent)]"
            />
            <ActionPill className="w-full" />
          </div>
          <div>
            <ActionPill
              icon={<DatadogLogo className="size-4" />}
              label="Check Datadog spike"
              className="bg-[radial-gradient(80%_100%_at_50%_0%,--theme(--color-foreground/.1),transparent)]"
            />
            <ActionPill
              icon={<SentryLogo className="size-4" />}
              label="Triage Sentry error"
              className="opacity-60"
            />
            <ActionPill className="w-full" />
          </div>
          <div>
            <ActionPill className="w-1/4" />
            <ActionPill
              icon={
                <span className="flex size-4 items-center justify-center overflow-hidden rounded-[2px] bg-foreground">
                  <NotionLogo className="size-4" />
                </span>
              }
              label="Update launch plan"
              className="bg-[radial-gradient(50%_80%_at_20%_10%,--theme(--color-foreground/.1),transparent)]"
            />
            <ActionPill
              icon={<GoogleLogo className="size-4" />}
              label="Draft Gmail reply"
              className="opacity-60"
            />
            <ActionPill className="w-full" />
          </div>
          <div>
            <ActionPill className="w-1/6" />
            <ActionPill
              icon={<AWSCloudWatchLogo className="size-4 rounded-[2px]" />}
              label="Pull CloudWatch logs"
              className="bg-[radial-gradient(50%_80%_at_20%_10%,--theme(--color-foreground/.1),transparent)]"
            />
            <ActionPill
              icon={<CalendarClock className="text-muted-foreground" />}
              label="Remind me Tuesday"
              className="opacity-60"
            />
            <ActionPill
              icon={<Hash className="text-muted-foreground" />}
              label="Post in #launch"
              className="opacity-40"
            />
            <ActionPill className="w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Voice, transcribed
// ---------------------------------------------------------------------------

const WAVE_HEIGHTS = [10, 18, 26, 14, 30, 22, 12, 24, 16, 28, 18, 10]

function VoiceCard() {
  return (
    <div className="group relative rounded-2xl border bg-card md:col-span-3 dark:bg-card/50">
      <div className="relative flex h-64 flex-col items-center justify-center gap-6 overflow-hidden px-6">
        <div className="flex h-10 items-end gap-1">
          {WAVE_HEIGHTS.map((height, index) => (
            <span
              key={`${index}-${height}`}
              className="w-1 rounded-full bg-agent/70 transition-all duration-600 ease-in-out group-hover:bg-agent"
              style={{ height }}
            />
          ))}
        </div>
        <div className="mask-b-from-40% w-full max-w-60 space-y-2">
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground/80">mira</span>{" "}
            let&rsquo;s ship the fix behind a flag first
          </p>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground/80">sam</span> agreed,
            flag goes out today, full rollout Friday
          </p>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground/80">mira</span> ok
            locking that in
          </p>
        </div>
      </div>
      <div className="p-6">
        <h3 className="font-medium text-base leading-tight md:text-lg">
          <span>Voice counts too.</span>{" "}
          <span className="text-muted-foreground">
            Calls are transcribed, so decisions made out loud are remembered
            like everything else.
          </span>
        </h3>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Native everywhere
// ---------------------------------------------------------------------------

function AppsCard() {
  return (
    <div className="group relative flex flex-col justify-between rounded-2xl border bg-card md:col-span-5 dark:bg-card/50">
      <div className="p-6">
        <h3 className="font-medium text-base leading-tight md:text-lg">
          <span>The chat your team already knows.</span>{" "}
          <span className="text-muted-foreground">
            Channels, threads, DMs, and reactions, native on desktop and mobile.
          </span>
        </h3>
      </div>
      <div className="flex items-end justify-between p-6 pt-0">
        <div className="flex gap-2">
          {[
            {
              icon: <Monitor className="size-5" strokeWidth={1.5} />,
              label: "Desktop",
            },
            {
              icon: <Smartphone className="size-5" strokeWidth={1.5} />,
              label: "Mobile",
            },
            {
              icon: <Globe className="size-5" strokeWidth={1.5} />,
              label: "Browser",
            },
          ].map((platform) => (
            <span
              key={platform.label}
              className="flex items-center gap-2 rounded-lg border bg-background px-3.5 py-2.5 font-medium text-[12.5px] text-foreground/85 shadow-xs"
            >
              {platform.icon}
              {platform.label}
            </span>
          ))}
        </div>
        <a
          href="/download"
          className="group/link inline-flex items-center gap-1.5 pb-1 font-medium text-[13px] text-foreground/75 transition-colors hover:text-foreground"
        >
          Download
          <ArrowRight
            className="size-3.5 transition-transform group-hover/link:translate-x-0.5"
            strokeWidth={1.75}
          />
        </a>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

export function AgentBento() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 py-24">
      <Reveal>
        <h2 className="max-w-2xl text-balance font-semibold text-4xl leading-[1.06] tracking-[-0.03em] md:text-[44px]">
          Answers are the start,{" "}
          <span className="text-foreground/55">not the whole job.</span>
        </h2>
      </Reveal>
      <Reveal delay={120}>
        <div className="mt-12 grid grid-cols-1 gap-2 md:grid-cols-8">
          <ActionsCard />
          <ContextCard />
          <VoiceCard />
          <AppsCard />
        </div>
      </Reveal>
    </section>
  )
}
