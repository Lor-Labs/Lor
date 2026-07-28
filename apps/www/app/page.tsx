import { ArrowRight } from "lucide-react"
import Image from "next/image"
import { AgentBento } from "@/app/components/agent-bento"
import { ClosingCTA } from "@/app/components/closing-cta"
import { OpenStack } from "@/app/components/open-stack"
import { Pricing } from "@/app/components/pricing"
import { ProductDemo } from "@/app/components/product-demo"
import { Reveal } from "@/app/components/reveal"
import { SiteFooter } from "@/app/components/site-footer"
import { WhyLor } from "@/app/components/why-lor"

const SIGNUP_URL = "https://app.lor.chat/signup"

// ---------------------------------------------------------------------------
// Hero — full-bleed image, atmospheric type, sign-up as the only action
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden">
      <Image
        src="/lor-bg.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="-z-10 object-cover object-center"
      />
      {/* Radial focal vignette — darkens where text lives, leaves the wizard and city alone */}
      <div
        aria-hidden
        className="-z-10 pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 82% 60% at 50% 32%, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.45) 38%, rgba(0,0,0,0.18) 62%, transparent 88%)",
        }}
      />
      {/* Bottom fade into the next section */}
      <div
        aria-hidden
        className="-z-10 pointer-events-none absolute inset-x-0 bottom-0 h-[28%] bg-gradient-to-b from-transparent to-background"
      />

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center md:pb-32">
        <Reveal>
          <h1 className="max-w-[16ch] text-balance font-cinzel text-4xl font-semibold leading-[1.04] tracking-normal sm:text-6xl md:text-[78px]">
            The multiplayer AI workspace.
          </h1>
        </Reveal>
        <Reveal delay={220}>
          <p className="mt-8 max-w-[52ch] text-balance text-[16.5px] leading-[1.6] text-foreground/80 sm:text-[18px]">
            Your team chat is already full of answers. Most of them scroll away
            forever. Lor turns every conversation into context your AI can cite
            and act on.
          </p>
        </Reveal>
        <Reveal delay={400}>
          <a
            href={SIGNUP_URL}
            className="group mt-10 inline-flex items-center gap-2 rounded-full bg-primary py-3 pl-6 pr-5 font-medium text-[15px] text-primary-foreground transition-[transform,background-color] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-primary/95 active:scale-[0.97]"
          >
            Get started
            <ArrowRight
              className="size-4 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5"
              strokeWidth={1.75}
            />
          </a>
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
      <ProductDemo />
      <AgentBento />
      <WhyLor />
      <OpenStack />
      <Pricing />
      <ClosingCTA />
      <SiteFooter />
    </div>
  )
}
