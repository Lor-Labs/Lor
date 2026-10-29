import { BetaSignup } from "@/app/components/beta-signup"
import { Reveal } from "@/app/components/reveal"
import { MACOS_DMG_URL } from "@/app/lib/urls"

export function ClosingCTA() {
  return (
    <section
      id="early-access"
      className="relative mx-auto w-full max-w-6xl scroll-mt-24 overflow-hidden px-6 py-32 md:py-44"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[420px] bg-[radial-gradient(ellipse_70%_90%_at_50%_110%,--theme(--color-agent/.12),transparent)]"
      />
      <Reveal>
        <div className="relative mx-auto flex max-w-2xl flex-col items-center text-center">
          <p className="font-mono text-xs text-foreground/50 uppercase tracking-[0.2em]">
            Free beta
          </p>
          <h2 className="mt-6 text-balance font-semibold text-4xl leading-[1.05] tracking-[-0.03em] md:text-[56px]">
            Bring the work.
            <span className="block">Get it done as a team.</span>
          </h2>
          {/* The offer mirrors BETA_POLICY (packages/billing). */}
          <p className="mt-6 max-w-md text-pretty text-[16px] text-muted-foreground leading-relaxed">
            Free for early teams. Keep $20 a seat for life when you subscribe.
          </p>
          <div className="mt-10 flex w-full max-w-xs flex-col gap-3">
            <BetaSignup className="w-full" />
            <a
              href={MACOS_DMG_URL}
              className="inline-flex h-12 w-full items-center justify-center rounded-full border border-foreground/15 font-medium text-[15px] text-foreground transition-colors hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"
            >
              Download for Mac
            </a>
          </div>
          <p className="mt-4 text-[13px] text-muted-foreground">
            Requires an Apple Silicon Mac
          </p>
        </div>
      </Reveal>
    </section>
  )
}
