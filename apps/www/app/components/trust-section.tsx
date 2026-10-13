import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { GitHubLogo } from "@repo/ui/components/logos/github"
import { Reveal } from "@/app/components/reveal"
import { GITHUB_URL } from "@/app/lib/urls"

// Trust line (reference/positioning.md): open source, open models, approvals,
// permissions. Replaces open-stack.tsx, which is kept but not rendered.

const MODELS = ["GLM", "Kimi", "Qwen"]

const PILLARS = [
  {
    title: "Approvals you choose",
    body: "Gate any tool, connector, or MCP server, and pick who can approve it.",
  },
  {
    title: "Roles and permissions",
    body: "Custom roles decide who can change the setup and connect new tools.",
  },
  {
    title: "Memory you can read",
    body: "What Lor knows lives in Postgres, in tables you can query.",
  },
]

export function TrustSection() {
  return (
    <section
      id="open-source"
      className="relative mx-auto w-full max-w-6xl px-6 py-24"
    >
      <Reveal>
        <h2 className="max-w-2xl text-balance font-semibold text-4xl leading-[1.06] tracking-[-0.03em] md:text-[44px]">
          Open source. Open models.{" "}
          <span className="text-foreground/55">Your rules.</span>
        </h2>
      </Reveal>

      <Reveal delay={120}>
        <div className="mt-12 grid grid-cols-1 gap-2 md:grid-cols-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col justify-between rounded-2xl border bg-card p-8 transition-colors hover:bg-card/80 dark:bg-card/50 dark:hover:bg-card/70"
          >
            <span className="flex size-12 items-center justify-center rounded-md border bg-background shadow-xs">
              <GitHubLogo className="size-6" />
            </span>
            <div className="mt-16">
              <h3 className="font-medium text-base leading-tight md:text-lg">
                <span>AGPL-3.0, built in the open.</span>{" "}
                <span className="text-muted-foreground">
                  The app, the server, and Lor in one repo. Read the code,
                  self-host it, or let us run it.
                </span>
              </h3>
              <span className="mt-4 inline-flex items-center gap-1.5 font-medium text-[13px] text-foreground/75 transition-colors group-hover:text-foreground">
                View on GitHub
                <HugeiconsIcon
                  icon={ArrowUpRight01Icon}
                  size={14}
                  className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                />
              </span>
            </div>
          </a>

          <div className="flex flex-col justify-between rounded-2xl border bg-card p-8 dark:bg-card/50">
            <div className="flex flex-wrap gap-2">
              {MODELS.map((model) => (
                <span
                  key={model}
                  className="rounded-lg border bg-background px-3.5 py-2 text-[13px] text-foreground/85 shadow-xs"
                >
                  {model}
                </span>
              ))}
              <span className="rounded-lg border border-dashed px-3.5 py-2 text-[13px] text-muted-foreground">
                your own
              </span>
            </div>
            <div className="mt-16">
              <h3 className="font-medium text-base leading-tight md:text-lg">
                <span>Runs on open models.</span>{" "}
                <span className="text-muted-foreground">
                  No lock-in to one lab. Self-hosters point Lor at any model
                  endpoint they like.
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
      </Reveal>
    </section>
  )
}
