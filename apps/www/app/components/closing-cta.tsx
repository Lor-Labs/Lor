import { WaitlistForm } from "@/app/components/waitlist-form"
import { BETA_INVITES_DATE, BETA_INVITES_LABEL } from "@/app/lib/launch"

export function ClosingCTA() {
  return (
    <section className="border-t border-foreground/10 px-5 py-16 sm:px-8 md:py-20">
      <div className="mx-auto grid max-w-[1240px] items-center gap-8 lg:grid-cols-[1fr_1.2fr] lg:gap-24">
        <div>
          <h2 className="text-3xl font-medium tracking-[-0.03em] md:text-4xl">
            Bring your team along.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Beta invites start{" "}
            <time dateTime={BETA_INVITES_DATE}>{BETA_INVITES_LABEL}</time>.
          </p>
        </div>
        <WaitlistForm />
      </div>
    </section>
  )
}
