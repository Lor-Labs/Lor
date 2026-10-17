import { ChatGptIcon, ClaudeIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import Image from "next/image"
import { AppMock } from "@/app/components/app-mock"
import { ClosingCTA } from "@/app/components/closing-cta"
import { ContextGraph } from "@/app/components/context-graph"
import { LaptopProblem } from "@/app/components/laptop-problem"
import { Reveal } from "@/app/components/reveal"
import { SiteFooter } from "@/app/components/site-footer"
import { TeamWeek } from "@/app/components/team-week"
import { WaitlistForm } from "@/app/components/waitlist-form"

// ---------------------------------------------------------------------------
// Hero — headline, signup, and the product itself
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section className="relative p-2 md:p-3">
      <div className="relative overflow-hidden rounded-[20px] bg-[radial-gradient(ellipse_75%_60%_at_50%_-10%,--theme(--color-agent/.13),transparent)] md:rounded-[28px]">
        <div
          aria-hidden
          className="mask-t-from-70% mask-b-from-70% absolute inset-x-0 bottom-0 aspect-[1672/941] min-h-[75%]"
        >
          <Image
            src="/hero-landscape.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-[78%_bottom]"
          />
        </div>
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-background/85 via-background/55 to-background/5"
        />
        <HeroContent />
      </div>
    </section>
  )
}

function AgentName({ icon, name }: { icon: IconSvgElement; name: string }) {
  return (
    <span className="whitespace-nowrap text-foreground">
      <HugeiconsIcon
        icon={icon}
        strokeWidth={1.75}
        className="mr-1 inline-block size-[1.1em] align-[-0.2em]"
      />
      {name}
    </span>
  )
}

function HeroContent() {
  return (
    <div className="relative mx-auto w-full max-w-6xl px-6 pt-36 pb-16 md:pt-44 md:pb-28">
      <Reveal>
        <h1 className="max-w-[17ch] text-balance font-semibold text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.03] tracking-[-0.035em]">
          The multiplayer runtime for your{" "}
          <span className="text-agent">team and agents.</span>
        </h1>
      </Reveal>

      <Reveal delay={140}>
        <div className="mt-9 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <p className="max-w-[540px] text-pretty text-[16px] text-foreground/75 leading-relaxed sm:text-[17px]">
            Bring <AgentName icon={ClaudeIcon} name="Claude Code" />,{" "}
            <AgentName icon={ChatGptIcon} name="Codex" />, or whatever agent you
            already pay for. Every session in Lor is shared with your team, so
            each agent builds on what the others already learned.
          </p>
          <WaitlistForm className="shrink-0" />
        </div>
      </Reveal>

      <Reveal delay={300}>
        <div className="mt-16 md:mt-20">
          <AppMock />
          <p className="sr-only">
            A #gtm session in Lor, run by Claude Code. It found 12 leads and
            drafted emails. Rafael asks Zoe to check the Paygrove draft, and Zoe
            tells the agent what to change.
          </p>
        </div>
      </Reveal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export default function Home() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <main>
        <Hero />
        <LaptopProblem />
        <ContextGraph />
        <TeamWeek />
        <ClosingCTA />
      </main>
      <SiteFooter />
    </div>
  )
}
