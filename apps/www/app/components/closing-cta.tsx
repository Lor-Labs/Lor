import { Reveal } from "@/app/components/reveal"
import { WaitlistForm } from "@/app/components/waitlist-form"
import { BETA_INVITES_DATE, BETA_INVITES_LABEL } from "@/app/lib/launch"

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
            Join the waitlist
          </p>
          <h2 className="mt-6 text-balance font-semibold text-4xl leading-[1.05] tracking-[-0.03em] md:text-[56px]">
            Bring the work.
            <span className="block">Get it done as a team.</span>
          </h2>
          <p className="mt-6 max-w-md text-pretty text-[16px] text-muted-foreground leading-relaxed">
            We&rsquo;ll start inviting teams on{" "}
            <time dateTime={BETA_INVITES_DATE}>{BETA_INVITES_LABEL}</time>.
            Leave your email and we&rsquo;ll let you know when it&rsquo;s your
            turn.
          </p>
          <WaitlistForm className="mt-10" align="center" />
        </div>
      </Reveal>
    </section>
  )
}
