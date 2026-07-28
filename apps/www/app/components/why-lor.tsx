import { AiBrain01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight,
  Hash,
  ListChecks,
  MessagesSquare,
  SlidersHorizontal,
} from "lucide-react"
import type { ReactNode } from "react"
import { Reveal } from "@/app/components/reveal"

const SIGNUP_URL = "https://app.lor.chat/signup"

const ROADMAP = [
  "Voice channels with transcripts Merlin can cite",
  "Merlin drafting pull requests",
  "More connectors, Notion up next",
]

// ---------------------------------------------------------------------------
// 1. Code investigation — wide card with a live terminal trace
// ---------------------------------------------------------------------------

function CodeCard() {
  return (
    <div className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border bg-card dark:bg-card/50">
      <div className="p-6">
        <h3 className="font-medium text-base leading-tight md:text-lg">
          <span>It reads your actual code.</span>{" "}
          <span className="text-muted-foreground">
            Ask why something broke and Merlin clones the repo into a sandbox,
            investigates with a coding agent, and reports back with file-level
            detail.
          </span>
        </h3>
      </div>
      <div className="px-6 pb-6">
        <div className="mask-b-from-55% rounded-lg border bg-background p-4 font-mono text-[12.5px] leading-relaxed shadow-xs transition-transform duration-600 ease-in-out group-hover:-translate-y-1">
          <p className="text-foreground/85">
            <span className="rounded bg-merlin/15 px-1 py-0.5 font-medium text-merlin">
              @merlin
            </span>{" "}
            why did checkout start failing last night
          </p>
          <p className="mt-3 text-merlin">
            investigate_code{" "}
            <span className="text-muted-foreground">lor/api</span>
          </p>
          <p className="mt-1 text-muted-foreground">
            cloning repository&hellip; done in 2.4s
          </p>
          <p className="text-muted-foreground">
            reading src/routes/checkout.ts
          </p>
          <p className="text-muted-foreground">
            tracing session handling in the webhook handler
          </p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. Verified citations — answer bubble with receipt chips
// ---------------------------------------------------------------------------

function ReceiptsCard() {
  return (
    <div className="group relative flex h-full flex-col rounded-2xl border bg-card dark:bg-card/50">
      <div className="p-6">
        <h3 className="font-medium text-base leading-tight md:text-lg">
          <span>Answers with receipts.</span>{" "}
          <span className="text-muted-foreground">
            Every answer cites the exact message, ticket, or page it came from.
            Citations are verified before they render.
          </span>
        </h3>
      </div>
      <div className="mt-auto px-6 pb-6">
        <div className="rounded-lg bg-accent/60 px-3 py-2.5 transition-transform duration-600 ease-in-out group-hover:-translate-y-1 dark:bg-accent/40">
          <p className="text-sm leading-snug text-foreground/85">
            Rate limits doubled after the May incident, per{" "}
            <span className="font-semibold text-foreground">amara</span>.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded border border-foreground/[0.08] bg-background px-1.5 py-0.5 font-medium text-[10.5px]">
              <Hash className="size-2.5" strokeWidth={2} />
              platform
            </span>
            <span className="inline-flex items-center rounded border border-foreground/[0.08] bg-background px-1.5 py-0.5 font-mono font-medium text-[10.5px] text-merlin">
              /decisions/rate-limits
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 3. Autonomous memory — brain page being written
// ---------------------------------------------------------------------------

function BrainCard() {
  return (
    <div className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border bg-card md:flex-row md:items-center dark:bg-card/50">
      <div className="p-6 md:max-w-[46%]">
        <h3 className="font-medium text-base leading-tight md:text-lg">
          <span>A brain that writes itself.</span>{" "}
          <span className="text-muted-foreground">
            Decisions get written to living memory pages automatically. The
            answer to &ldquo;why did we do it this way&rdquo; outlives the
            person who made the call.
          </span>
        </h3>
      </div>
      <div className="px-6 pb-6 md:flex-1 md:py-6 md:pl-0">
        <div className="rounded-lg border bg-background p-4 font-mono text-[12.5px] leading-relaxed shadow-xs transition-transform duration-600 ease-in-out group-hover:-translate-y-1">
          <p className="flex items-center gap-2 text-foreground/85">
            <HugeiconsIcon
              icon={AiBrain01Icon}
              size={14}
              strokeWidth={2}
              className="text-merlin"
            />
            /decisions/pricing-2026
          </p>
          <p className="mt-2 text-merlin">
            + Seat price set to $20 with pooled credits
          </p>
          <p className="text-merlin">+ Top-ups burn after monthly credits</p>
          <p className="mt-2 text-muted-foreground">
            written from #billing, Jul 26
          </p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compact cards
// ---------------------------------------------------------------------------

function CompactCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="group h-full rounded-2xl border bg-card p-6 dark:bg-card/50">
      <div className="flex size-10 items-center justify-center rounded-md border bg-background text-merlin shadow-xs transition-colors duration-600 ease-in-out group-hover:bg-merlin/10">
        {icon}
      </div>
      <h3 className="mt-5 font-medium text-base leading-tight">
        <span>{title}.</span>{" "}
        <span className="text-muted-foreground">{body}</span>
      </h3>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

export function WhyLor() {
  return (
    <section
      id="why-lor"
      className="relative mx-auto w-full max-w-6xl px-6 py-24"
    >
      <Reveal>
        <div className="max-w-2xl">
          <p className="font-medium text-[13px] text-merlin/90 uppercase tracking-[0.18em]">
            Why teams switch
          </p>
          <h2 className="mt-4 text-balance font-semibold text-4xl leading-[1.05] tracking-[-0.03em] md:text-5xl">
            Built AI-native.
            <span className="text-foreground/55"> Not bolted on.</span>
          </h2>
          <p className="mt-5 text-pretty text-[15px] text-foreground/60 leading-relaxed">
            Merlin isn&rsquo;t a chatbot in a side panel. It&rsquo;s a member of
            your workspace that reads what your team reads and remembers what
            your team decides.
          </p>
        </div>
      </Reveal>

      <div className="mt-14 grid grid-cols-1 gap-2 md:grid-cols-8">
        <Reveal className="md:col-span-5">
          <CodeCard />
        </Reveal>
        <Reveal className="md:col-span-3" delay={90}>
          <ReceiptsCard />
        </Reveal>
        <Reveal className="md:col-span-3" delay={120}>
          <CompactCard
            icon={<ListChecks className="size-5" strokeWidth={1.75} />}
            title="It does the busywork"
            body="Merlin files Linear issues, comments on tickets, and digs through Datadog logs without leaving the conversation."
          />
        </Reveal>
        <Reveal className="md:col-span-5" delay={180}>
          <BrainCard />
        </Reveal>
        <Reveal className="md:col-span-4" delay={240}>
          <CompactCard
            icon={<MessagesSquare className="size-5" strokeWidth={1.75} />}
            title="A real chat app"
            body="Channels, threads, DMs, reactions, pins, search, plus native desktop and mobile apps. Your team gives up nothing to get the AI."
          />
        </Reveal>
        <Reveal className="md:col-span-4" delay={300}>
          <CompactCard
            icon={<SlidersHorizontal className="size-5" strokeWidth={1.75} />}
            title="You control the blast radius"
            body="Capability profiles gate what Merlin can do per channel. Full tool access in #engineering, read-only answers in #general."
          />
        </Reveal>
      </div>

      <div className="relative mt-2 overflow-hidden rounded-2xl border border-merlin/25 bg-card dark:bg-card/60">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(50%_120%_at_20%_0%,--theme(--color-merlin/.12),transparent)]"
        />
        <div className="relative flex flex-col items-start justify-between gap-6 p-8 md:flex-row md:items-center">
          <div>
            <h3 className="font-semibold text-2xl tracking-[-0.02em]">
              Start with 2,000 free credits.
            </h3>
            <p className="mt-2 max-w-md text-[14px] text-muted-foreground leading-relaxed">
              Every new workspace gets $20 of AI usage on us. Try Merlin on your
              real questions before a card ever comes out.
            </p>
          </div>
          <a
            href={SIGNUP_URL}
            className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-foreground py-2.5 pl-5 pr-4 font-medium text-[14px] text-background transition-[transform,background-color] hover:bg-foreground/90 active:scale-[0.97]"
          >
            Claim your credits
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              strokeWidth={1.75}
            />
          </a>
        </div>
      </div>

      <div className="mt-2 flex flex-col items-start gap-3 rounded-2xl border border-dashed p-6 md:flex-row md:items-center">
        <span className="shrink-0 font-medium text-[12px] text-muted-foreground uppercase tracking-[0.14em]">
          On the roadmap
        </span>
        <div className="flex flex-wrap gap-2">
          {ROADMAP.map((item) => (
            <span
              key={item}
              className="rounded-full border bg-background px-3 py-1 text-[12.5px] text-foreground/70"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
