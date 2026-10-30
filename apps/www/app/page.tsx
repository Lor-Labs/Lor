import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import Image from "next/image"
import { ClosingCTA } from "@/app/components/closing-cta"
import { DemoVideo } from "@/app/components/demo-video"
import { FAQ } from "@/app/components/faq"
import { SiteFooter } from "@/app/components/site-footer"
import { VisionSections } from "@/app/components/vision-sections"
import { WaitlistForm } from "@/app/components/waitlist-form"
import { WorkspaceStory } from "@/app/components/workspace-story"
import {
  BETA_INVITES_DATE,
  BETA_INVITES_LABEL,
  DEMO_VIDEO,
} from "@/app/lib/launch"

function Hero() {
  return (
    <section className="relative isolate overflow-hidden px-5 pt-36 pb-16 sm:px-8 md:pt-44 md:pb-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-48 -z-10 h-[850px] opacity-35"
      >
        <Image
          src="/hero-landscape.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-bottom"
        />
        <div className="absolute inset-0 bg-linear-to-b from-background via-background/65 to-background" />
      </div>
      <div className="mx-auto max-w-[1240px]">
        <p className="mb-7 flex items-center gap-2.5 text-sm text-foreground/65">
          <span className="size-1.5 rounded-full bg-agent" />A workspace for
          your whole team
        </p>
        <div className="grid items-start gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
          <h1 className="max-w-[14ch] text-balance font-medium text-[clamp(3.25rem,6.7vw,6rem)] leading-[1.02] tracking-[-0.055em]">
            Work with AI,
            <span className="block text-foreground/45">together.</span>
          </h1>
          <div className="pb-1 lg:pb-2">
            <p className="max-w-[36ch] text-pretty text-[17px] text-foreground/70 leading-relaxed md:text-lg">
              Research, build, and make decisions with AI in a shared workspace.
              Your team can join in and pick up where you left off.
            </p>
            <div className="mt-8">
              <WaitlistForm />
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Beta invites start{" "}
                <time dateTime={BETA_INVITES_DATE}>{BETA_INVITES_LABEL}</time>.
              </p>
              <a
                href="#workspace"
                className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"
              >
                {DEMO_VIDEO.src ? "Watch the demo" : "Explore the workspace"}{" "}
                <HugeiconsIcon icon={ArrowDown01Icon} size={15} />
              </a>
            </div>
          </div>
        </div>
        <div id="workspace" className="mt-16 scroll-mt-28 md:mt-20">
          {DEMO_VIDEO.src ? (
            <DemoVideo />
          ) : (
            <>
              <WorkspaceStory />
              <p className="mt-4 text-center text-sm text-muted-foreground">
                An illustrated preview of working together in Lor.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

export default function Home() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <main id="main-content">
        <Hero />
        <VisionSections />
        <FAQ />
        <ClosingCTA />
      </main>
      <SiteFooter />
    </div>
  )
}
