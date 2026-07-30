import { Github } from "lucide-react"
import { CtaPrimary, CtaSecondary } from "@/app/components/cta"
import { Reveal } from "@/app/components/reveal"
import { GITHUB_URL, SIGNUP_URL } from "@/app/lib/urls"

export function ClosingCTA() {
  return (
    <section className="relative mx-auto w-full max-w-6xl overflow-hidden px-6 py-32 md:py-44">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[420px] bg-[radial-gradient(ellipse_70%_90%_at_50%_110%,--theme(--color-merlin/.12),transparent)]"
      />
      <Reveal>
        <div className="relative mx-auto flex max-w-2xl flex-col items-center text-center">
          <h2 className="text-balance font-semibold text-4xl leading-[1.05] tracking-[-0.03em] md:text-[56px]">
            The lore is yours.
            <br />
            <span className="text-foreground/55">So is your context.</span>
          </h2>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            <CtaPrimary href={SIGNUP_URL}>Start free</CtaPrimary>
            <CtaSecondary href={GITHUB_URL} external>
              <Github className="size-4" strokeWidth={1.75} />
              View on GitHub
            </CtaSecondary>
          </div>
          <p className="mt-6 text-[13px] text-muted-foreground">
            New workspaces start with 2,000 free credits. No card required.
          </p>
        </div>
      </Reveal>
    </section>
  )
}
