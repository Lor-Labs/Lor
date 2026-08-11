import { ArrowUpRight, Check } from "lucide-react"
import { Reveal } from "@/app/components/reveal"
import { SIGNUP_URL } from "@/app/lib/urls"

const CLOUD_FEATURES = [
  "Unlimited channels, threads, and voice",
  "Merlin on every channel: answers, actions, memory",
  "AI credits included, pooled across your whole team",
  "Buy additional credits anytime usage runs hot",
  "All connectors: GitHub, Linear, Notion, and more",
]

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <Check
            className="mt-0.5 size-4 shrink-0 text-merlin/90"
            strokeWidth={2}
          />
          <span className="text-[14px] text-foreground/75 leading-snug">
            {item}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function Pricing() {
  return (
    <section
      id="pricing"
      className="relative mx-auto w-full max-w-6xl px-6 py-24"
    >
      <Reveal>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance font-semibold text-4xl leading-[1.06] tracking-[-0.03em] md:text-[44px]">
            One plan.
            <span className="text-foreground/55"> Everything included.</span>
          </h2>
          <p className="mt-5 text-pretty text-[15px] text-foreground/60 leading-relaxed">
            One $20 seat covers the team chat, the AI that answers from it, and
            the search across every connected tool. Every seat adds credits to a
            shared pool. No tiers, no gates, no enterprise call.
          </p>
        </div>
      </Reveal>

      <div className="relative mx-auto mt-14 max-w-3xl">
        <div
          aria-hidden
          className="-z-1 absolute inset-x-10 top-10 bottom-2 rounded-2xl bg-merlin/15 blur-2xl"
        />
        <div className="relative overflow-hidden rounded-2xl border border-merlin/25 bg-card p-8 md:p-10 dark:bg-card/60">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(70%_100%_at_15%_0%,--theme(--color-merlin/.14),transparent)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 bottom-0 h-40 w-80 bg-[radial-gradient(80%_100%_at_100%_100%,--theme(--color-merlin/.08),transparent)]"
          />
          <div className="relative grid grid-cols-1 gap-10 md:grid-cols-2">
            <div className="flex flex-col">
              <div className="flex items-baseline gap-2.5">
                <span className="font-semibold text-6xl tracking-[-0.03em]">
                  $20
                </span>
                <span className="text-[14px] text-muted-foreground">
                  per user / month
                </span>
              </div>
              <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
                Everything, for everyone. AI usage is metered in credits. Each
                seat adds to the pool, and you can top up whenever.
              </p>
              <a
                href={SIGNUP_URL}
                className="group mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-merlin to-primary py-2.5 font-medium text-[14px] text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_4px_10px_-2px_rgba(97,60,214,0.4)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 active:translate-y-0 md:mt-auto"
              >
                Get started
                <ArrowUpRight
                  className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  strokeWidth={1.75}
                />
              </a>
              <p className="mt-3 text-center text-[12.5px] text-muted-foreground">
                New workspaces start with 2,000 free credits.
              </p>
            </div>
            <div className="border-foreground/[0.08] md:border-l md:pl-10">
              <p className="font-medium text-[13px] text-muted-foreground">
                What&rsquo;s included
              </p>
              <div className="mt-5">
                <FeatureList items={CLOUD_FEATURES} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
