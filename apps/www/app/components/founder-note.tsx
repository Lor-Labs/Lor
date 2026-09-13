import { Reveal } from "@/app/components/reveal"

export function FounderNote() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 py-24 md:py-32">
      <Reveal>
        <div className="mx-auto max-w-2xl">
          <h2 className="text-balance font-semibold text-4xl leading-[1.06] tracking-[-0.03em] md:text-[44px]">
            The tool I kept{" "}
            <span className="text-foreground/55">wishing my teams had.</span>
          </h2>
          <div className="mt-8 flex flex-col gap-5 text-[16.5px] text-foreground/70 leading-[1.7]">
            <p>
              Every team I&rsquo;ve worked on had the same ritual. Someone asks
              a question, someone else says &ldquo;we talked about this, let me
              find it,&rdquo; and ten minutes disappear into scrollback and doc
              archaeology. The answer existed. Nobody could produce it.
            </p>
            <p>
              Lor is the tool I wanted on those teams. The conversation is the
              input, Lor is the memory, and nothing your team figures out has to
              be figured out twice.
            </p>
          </div>
          <div className="mt-8 flex items-center gap-3.5">
            <span className="flex size-10 select-none items-center justify-center rounded-full bg-agent/15 font-medium text-[15px] text-agent">
              J
            </span>
            <div>
              <p className="font-medium text-[14.5px]">Jacob Owens</p>
              <p className="text-[13px] text-muted-foreground">Building Lor</p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
