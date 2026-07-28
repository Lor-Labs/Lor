import { AiBrain01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight,
  BookMarked,
  ListChecks,
  MessagesSquare,
  SlidersHorizontal,
  TerminalSquare,
} from "lucide-react"
import type { ReactNode } from "react"
import { Reveal } from "@/app/components/reveal"

const SIGNUP_URL = "https://app.lor.chat/signup"

type Feature = {
  icon: ReactNode
  title: string
  body: string
}

const FEATURES: Feature[] = [
  {
    icon: <BookMarked className="size-5" strokeWidth={1.75} />,
    title: "Ask anything, get cited answers",
    body: "Merlin answers from your channels, tickets, and docs, and links every claim to its source.",
  },
  {
    icon: <TerminalSquare className="size-5" strokeWidth={1.75} />,
    title: "Investigates your code",
    body: "Point it at a bug and it clones the repo, digs in, and reports back with file-level detail.",
  },
  {
    icon: <HugeiconsIcon icon={AiBrain01Icon} size={20} strokeWidth={1.75} />,
    title: "Remembers decisions",
    body: "Important calls are saved to memory pages your whole team can search later.",
  },
  {
    icon: <ListChecks className="size-5" strokeWidth={1.75} />,
    title: "Handles the busywork",
    body: "Files Linear issues, comments on tickets, and digs through Datadog logs for you.",
  },
  {
    icon: <MessagesSquare className="size-5" strokeWidth={1.75} />,
    title: "Works like the chat you know",
    body: "Channels, threads, DMs, reactions, search, plus native desktop and mobile apps.",
  },
  {
    icon: <SlidersHorizontal className="size-5" strokeWidth={1.75} />,
    title: "You choose what it can do",
    body: "Limit Merlin's tools channel by channel, from full access to read-only.",
  },
]

const ROADMAP = [
  "Voice channels with transcripts Merlin can cite",
  "Merlin drafting pull requests",
  "More connectors, Notion up next",
]

export function WhyLor() {
  return (
    <section
      id="why-lor"
      className="relative mx-auto w-full max-w-6xl px-6 py-24"
    >
      <Reveal>
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-medium text-[13px] text-merlin/90 uppercase tracking-[0.18em]">
            Features
          </p>
          <h2 className="mt-4 text-balance font-semibold text-4xl leading-[1.05] tracking-[-0.03em] md:text-5xl">
            What your team gets.
          </h2>
        </div>
      </Reveal>

      <div className="mx-auto mt-14 grid max-w-4xl grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2">
        {FEATURES.map((feature, index) => (
          <Reveal key={feature.title} delay={index * 60}>
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-background text-merlin shadow-xs">
                {feature.icon}
              </div>
              <div>
                <h3 className="font-medium text-[15px]">{feature.title}</h3>
                <p className="mt-1 text-[14px] text-muted-foreground leading-relaxed">
                  {feature.body}
                </p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="relative mx-auto mt-16 max-w-4xl overflow-hidden rounded-2xl border border-merlin/25 bg-card dark:bg-card/60">
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

      <div className="mx-auto mt-2 flex max-w-4xl flex-col items-start gap-3 rounded-2xl border border-dashed p-6 md:flex-row md:items-center">
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
