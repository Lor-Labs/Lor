import type { ReactNode } from "react"
import { Reveal } from "@/app/components/reveal"

export type ChapterPoint = {
  lead: string
  body: string
}

// Split feature chapter: two-tone headline + bold-lead points on one side,
// a product mock on the other. `flip` swaps the columns on desktop.
export function Chapter({
  id,
  title,
  titleMuted,
  points,
  mock,
  flip = false,
}: {
  id?: string
  title: string
  titleMuted: string
  points: ChapterPoint[]
  mock: ReactNode
  flip?: boolean
}) {
  return (
    <section id={id} className="relative mx-auto w-full max-w-6xl px-6 py-24">
      <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-16">
        <Reveal className={flip ? "md:order-2" : ""}>
          <div>
            <h2 className="text-balance font-semibold text-4xl leading-[1.06] tracking-[-0.03em] md:text-[44px]">
              {title} <span className="text-foreground/55">{titleMuted}</span>
            </h2>
            <div className="mt-8 flex flex-col gap-5">
              {points.map((point) => (
                <p
                  key={point.lead}
                  className="text-[15px] text-muted-foreground leading-relaxed"
                >
                  <span className="font-medium text-foreground">
                    {point.lead}
                  </span>{" "}
                  {point.body}
                </p>
              ))}
            </div>
          </div>
        </Reveal>
        <Reveal delay={140} className={flip ? "md:order-1" : ""}>
          {mock}
        </Reveal>
      </div>
    </section>
  )
}
