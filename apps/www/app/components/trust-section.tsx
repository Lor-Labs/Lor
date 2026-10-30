import { ArrowDown01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { GitHubLogo } from "@repo/ui/components/logos/github"
import { Toggle } from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { Reveal } from "@/app/components/reveal"
import { GITHUB_URL } from "@/app/lib/urls"

// Trust line (reference/positioning.md): open source, open models, approvals.
// The approvals card copies Settings › Approvals (approvals-section.tsx).
// Replaces open-stack.tsx, which is kept but not rendered.

const MODELS = ["GLM 5.3 Flash", "Kimi K3", "Qwen3 Embedding"]

const GATES = [
  {
    label: "Write to Linear",
    description: "Create and update issues and post comments",
    approver: "Role: Admin",
  },
  {
    label: "Code Actions",
    description:
      "Make code changes and open pull requests for the team to review",
    approver: "Rafael",
  },
  {
    label: "Web Search",
    description: "Search the web and read public pages",
    approver: null,
  },
]

function ApprovalsSettings() {
  return (
    <MockShell>
      <div aria-hidden className="p-5 text-left md:p-6">
        <p className="font-semibold text-[15px] text-lor-text-dark">
          Approvals
        </p>
        <p className="mt-1 text-[12.5px] text-lor-text-tertiary-dark leading-relaxed">
          Turn an action on here and Lor asks first. The action waits until
          someone approves it.
        </p>
        <p className="mt-5 font-medium text-[11.5px] text-lor-text-tertiary-dark">
          Connector capabilities
        </p>
        <div className="mt-2 rounded-xl bg-foreground/[0.03] px-4">
          {GATES.map((gate) => (
            <div
              key={gate.label}
              className="border-lor-border-dark/50 border-t py-3 first:border-t-0"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[13px] text-lor-text-dark">{gate.label}</p>
                  <p className="truncate text-[12px] text-lor-text-tertiary-dark">
                    {gate.description}
                  </p>
                </div>
                <Toggle on={gate.approver !== null} />
              </div>
              {gate.approver ? (
                <div className="mt-2.5 flex items-center gap-2 text-[11.5px] text-lor-text-tertiary-dark">
                  Who can approve
                  <span className="flex w-40 items-center justify-between rounded-md border border-lor-border-dark bg-lor-bg-dark px-2 py-1 text-lor-text-dark">
                    {gate.approver}
                    <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
                  </span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </MockShell>
  )
}

export function TrustSection() {
  return (
    <section
      id="open-source"
      className="relative mx-auto w-full max-w-6xl px-6 py-24"
    >
      <Reveal>
        <h2 className="font-semibold text-3xl leading-[1.08] tracking-[-0.03em] md:text-[40px]">
          Open source. Open models. Your rules.
        </h2>
      </Reveal>

      <div className="mt-12 grid grid-cols-1 gap-2 md:grid-cols-[7fr_5fr]">
        <Reveal delay={120}>
          <ApprovalsSettings />
        </Reveal>

        <Reveal delay={240} className="flex flex-col gap-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-1 flex-col justify-between rounded-2xl border bg-card p-6 transition-colors hover:bg-card/80 dark:bg-card/50 dark:hover:bg-card/70"
          >
            <span className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-md border bg-background shadow-xs">
                <GitHubLogo className="size-5" />
              </span>
              <span className="font-mono text-[13px] text-foreground/75">
                Lor-Labs/Lor
              </span>
            </span>
            <span className="mt-10 flex items-end justify-between gap-4">
              <span className="font-medium text-base leading-tight md:text-lg">
                AGPL-3.0.{" "}
                <span className="text-muted-foreground">
                  App, server, and Lor in one repo.
                </span>
              </span>
              <HugeiconsIcon
                icon={ArrowUpRight01Icon}
                size={16}
                className="shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
              />
            </span>
          </a>

          <div className="flex flex-1 flex-col justify-between rounded-2xl border bg-card p-6 dark:bg-card/50">
            <div className="flex flex-wrap gap-2">
              {MODELS.map((model) => (
                <span
                  key={model}
                  className="rounded-lg border bg-background px-3 py-1.5 text-[12.5px] text-foreground/85 shadow-xs"
                >
                  {model}
                </span>
              ))}
              <span className="rounded-lg border border-dashed px-3 py-1.5 text-[12.5px] text-muted-foreground">
                your own
              </span>
            </div>
            <p className="mt-10 font-medium text-base leading-tight md:text-lg">
              Open models.{" "}
              <span className="text-muted-foreground">
                Self-hosters bring any endpoint.
              </span>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
