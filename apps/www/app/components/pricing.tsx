import { Infinity01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUpRight, Check } from "lucide-react"
import { PersonAvatar, ZOE } from "@/app/components/mock-parts"
import { Reveal } from "@/app/components/reveal"
import { SIGNUP_URL } from "@/app/lib/urls"

const CLOUD_FEATURES = [
  "Unlimited channels, sessions, and voice",
  "An agent in every channel, on demand or on a schedule",
  "Approvals, custom roles, and permissions",
  "Your own OpenAI or Anthropic plan for the sessions you start",
  "Credits for cloud runs, pooled across the team",
  "All connectors: Attio, GitHub, Linear, Notion, and more",
]

// Who pays for a run: a person's own plan when they prompt Lor, workspace
// credits for cloud runs nobody prompted (loops, triggers).
const USAGE = [
  {
    who: "You ask Lor",
    pays: "Your ChatGPT or Claude plan",
    icon: <PersonAvatar src={ZOE} size="size-5" />,
  },
  {
    who: "A loop or trigger runs",
    pays: "Cloud credits",
    icon: (
      <HugeiconsIcon icon={Infinity01Icon} size={16} className="text-agent" />
    ),
  },
]

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <Check
            className="mt-0.5 size-4 shrink-0 text-agent/90"
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
            One $20 seat covers the team chat, the agent in every channel, and
            every connector. Bring your own OpenAI or Anthropic plan. Credits
            only pay for cloud runs.
          </p>
        </div>
      </Reveal>

      <div className="relative mx-auto mt-14 max-w-3xl">
        <div
          aria-hidden
          className="-z-1 absolute inset-x-10 top-10 bottom-2 rounded-2xl bg-agent/15 blur-2xl"
        />
        <div className="relative overflow-hidden rounded-2xl border border-agent/25 bg-card p-8 md:p-10 dark:bg-card/60">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(70%_100%_at_15%_0%,--theme(--color-agent/.14),transparent)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 bottom-0 h-40 w-80 bg-[radial-gradient(80%_100%_at_100%_100%,--theme(--color-agent/.08),transparent)]"
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
              <div className="mt-6 flex flex-col divide-y divide-foreground/[0.08] rounded-xl border border-foreground/[0.08] bg-foreground/[0.02]">
                {USAGE.map((row) => (
                  <div
                    key={row.who}
                    className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]"
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center">
                      {row.icon}
                    </span>
                    <span className="flex-1 text-foreground/85">{row.who}</span>
                    <span className="text-right text-muted-foreground">
                      {row.pays}
                    </span>
                  </div>
                ))}
              </div>
              <a
                href={SIGNUP_URL}
                className="group mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-agent to-primary py-2.5 font-medium text-[14px] text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_4px_10px_-2px_rgba(97,60,214,0.4)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 active:translate-y-0 md:mt-auto"
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
