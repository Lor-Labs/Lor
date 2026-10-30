import Image from "next/image"
import { DemoVideo } from "@/app/components/demo-video"
import { FAQ } from "@/app/components/faq"
import { SiteFooter } from "@/app/components/site-footer"
import { WaitlistForm } from "@/app/components/waitlist-form"
import { WorkspaceStory } from "@/app/components/workspace-story"
import {
  BETA_INVITES_DATE,
  BETA_INVITES_LABEL,
  DEMO_VIDEO,
} from "@/app/lib/launch"

function Hero() {
  return (
    <section className="relative isolate overflow-hidden px-5 pt-32 pb-12 sm:px-8 md:pt-40 md:pb-16">
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
        <div className="grid items-start gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
          <h1 className="max-w-[14ch] text-balance font-medium text-[clamp(3.25rem,6.7vw,6rem)] leading-[1.02] tracking-[-0.055em]">
            Work with AI,
            <span className="block text-foreground/45">together.</span>
          </h1>
          <div id="early-access" className="scroll-mt-8 pb-1 lg:pb-2">
            <p className="max-w-[36ch] text-pretty text-[17px] text-foreground/70 leading-relaxed md:text-lg">
              A shared workspace for your team and AI. Research, write, and code
              together, with everyone in the same conversation.
            </p>
            <div className="mt-8">
              <WaitlistForm />
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Beta invites start{" "}
                <time dateTime={BETA_INVITES_DATE}>{BETA_INVITES_LABEL}</time>.
              </p>
            </div>
          </div>
        </div>
        <div id="workspace" className="mt-12 scroll-mt-8 md:mt-16">
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
        <FAQ />
      </main>
      <SiteFooter />
    </div>
  )
}
