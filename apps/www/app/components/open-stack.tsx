import { ArrowUpRight, Github } from "lucide-react"
import { Reveal } from "@/app/components/reveal"
import { GITHUB_URL } from "@/app/lib/urls"

const MODELS = ["Kimi K2", "GLM", "Inkling", "DeepSeek", "Qwen"]

const PILLARS = [
  {
    title: "Self-host everything",
    body: "The whole stack runs on your own metal: Postgres, Redis, and the inference endpoint you point it at.",
  },
  {
    title: "No model lock-in",
    body: "Open weights can't be deprecated out from under you. Swap one model for another without touching your data.",
  },
  {
    title: "Auditable memory",
    body: "Everything Lor knows lives in your database, in tables you can query, not in someone else's black box.",
  },
]

export function OpenStack() {
  return (
    <section
      id="open-source"
      className="relative mx-auto w-full max-w-6xl px-6 py-24"
    >
      <Reveal>
        <h2 className="max-w-2xl text-balance font-semibold text-4xl leading-[1.06] tracking-[-0.03em] md:text-[44px]">
          Open source. Open models.{" "}
          <span className="text-foreground/55">No black boxes.</span>
        </h2>
      </Reveal>

      <div className="mt-12 grid grid-cols-1 gap-2 md:grid-cols-2">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-card p-8 transition-colors hover:bg-card/80 dark:bg-card/50 dark:hover:bg-card/70"
        >
          <div className="flex size-12 items-center justify-center rounded-md border bg-background shadow-xs">
            <Github className="size-6" strokeWidth={1.5} />
          </div>
          <div className="mt-16">
            <h3 className="font-medium text-base leading-tight md:text-lg">
              <span>AGPL-3.0, built in the open.</span>{" "}
              <span className="text-muted-foreground">
                App, server, and Lor, all in one repo. Fork it, self-host it,
                send a PR.
              </span>
            </h3>
            <span className="mt-4 inline-flex items-center gap-1.5 font-medium text-[13px] text-foreground/75 transition-colors group-hover:text-foreground">
              Star on GitHub
              <ArrowUpRight
                className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                strokeWidth={1.75}
              />
            </span>
          </div>
        </a>

        <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-card p-8 dark:bg-card/50">
          <div className="flex flex-wrap gap-2">
            {MODELS.map((model) => (
              <span
                key={model}
                className="rounded-lg border bg-background px-3.5 py-2 font-mono text-[13px] text-foreground/85 shadow-xs"
              >
                {model}
              </span>
            ))}
            <span className="rounded-lg border border-dashed px-3.5 py-2 font-mono text-[13px] text-muted-foreground">
              your own
            </span>
          </div>
          <div className="mt-16">
            <h3 className="font-medium text-base leading-tight md:text-lg">
              <span>Powered entirely by open models.</span>{" "}
              <span className="text-muted-foreground">
                Lor never calls a proprietary API. In the cloud we route each
                task to the best open model; self-hosters bring any endpoint
                they like.
              </span>
            </h3>
          </div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 divide-y overflow-hidden rounded-2xl border bg-card md:grid-cols-3 md:divide-x md:divide-y-0 dark:bg-card/50">
        {PILLARS.map((pillar) => (
          <div key={pillar.title} className="p-6">
            <h3 className="font-medium text-base leading-tight">
              <span>{pillar.title}.</span>{" "}
              <span className="text-muted-foreground">{pillar.body}</span>
            </h3>
          </div>
        ))}
      </div>
    </section>
  )
}
