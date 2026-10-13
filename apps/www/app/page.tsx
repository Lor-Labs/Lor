import { Check } from "lucide-react"
import { AgentBento } from "@/app/components/agent-bento"
import { AppMock } from "@/app/components/app-mock"
import { ClosingCTA } from "@/app/components/closing-cta"
import { CtaPrimary, CtaSecondary } from "@/app/components/cta"
import {
  AskChapter,
  ConnectChapter,
  RememberChapter,
} from "@/app/components/feature-chapters"
import { FounderNote } from "@/app/components/founder-note"
import { OpenStack } from "@/app/components/open-stack"
import { Pricing } from "@/app/components/pricing"
import { Reveal } from "@/app/components/reveal"
import { SiteFooter } from "@/app/components/site-footer"
import { SIGNUP_URL } from "@/app/lib/urls"

const HERO_POINTS = [
  { lead: "Give each channel an agent", rest: " with your team's tools" },
  { lead: "It works when you ask", rest: ", or on a schedule" },
  { lead: "Everyone sees the work", rest: ", and anyone can step in" },
  { lead: "You choose what needs approval", rest: ", and who gives it" },
]

// ---------------------------------------------------------------------------
// Hero — headline, proof points, and the product itself
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section id="product" className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(ellipse_75%_60%_at_50%_-10%,--theme(--color-agent/.13),transparent)]"
      />
      <div className="relative mx-auto w-full max-w-6xl px-6 pt-40 md:pt-48">
        <Reveal>
          <h1 className="max-w-[15ch] text-balance font-semibold text-[clamp(2.75rem,6.5vw,4.75rem)] leading-[1.03] tracking-[-0.035em]">
            AI agents your{" "}
            <span className="whitespace-nowrap text-agent">whole team</span> can
            steer.
          </h1>
        </Reveal>

        <Reveal delay={140}>
          <div className="mt-9 flex flex-col justify-between gap-8 sm:flex-row sm:items-end">
            <ul className="flex max-w-[560px] flex-col gap-2.5">
              {HERO_POINTS.map((point) => (
                <li
                  key={point.lead}
                  className="flex items-start gap-2.5 text-[15px] text-foreground/60 leading-snug sm:text-[16px]"
                >
                  <Check
                    className="mt-1 size-4 shrink-0 text-agent"
                    strokeWidth={2.5}
                  />
                  <span className="text-balance">
                    <span className="text-foreground">{point.lead}</span>
                    {point.rest}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex shrink-0 flex-col items-start gap-3 sm:flex-row sm:items-center">
              <CtaPrimary href={SIGNUP_URL}>Start free</CtaPrimary>
              <CtaSecondary href="/download">Download for Mac</CtaSecondary>
            </div>
          </div>
        </Reveal>

        <Reveal delay={300}>
          <div className="mt-16 md:mt-20">
            <AppMock />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export default function Home() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Hero />
      <AskChapter />
      <ConnectChapter />
      <RememberChapter />
      <AgentBento />
      <OpenStack />
      <FounderNote />
      <Pricing />
      <ClosingCTA />
      <SiteFooter />
    </div>
  )
}
