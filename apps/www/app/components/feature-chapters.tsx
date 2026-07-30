import { DatadogLogo } from "@repo/ui/components/logos/datadog"
import { LinearLogo } from "@repo/ui/components/logos/linear"
import { NotionLogo } from "@repo/ui/components/logos/notion"
import { SentryLogo } from "@repo/ui/components/logos/sentry"
import { Check, FileText, Github, Hash } from "lucide-react"
import type { ReactNode } from "react"
import {
  LinearChipIcon,
  MerlinAvatar,
  NotionChipIcon,
  SourceChip,
} from "@/app/components/app-mock"
import { Chapter } from "@/app/components/chapter"
import { MockShell } from "@/app/components/mock-shell"

// ---------------------------------------------------------------------------
// 01 — Ask: a cited answer, with the citation preview open
// ---------------------------------------------------------------------------

function AskMock() {
  return (
    <MockShell>
      <div aria-hidden className="relative p-5 text-left md:p-6">
        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 select-none items-center justify-center rounded-full bg-sky-700 font-medium text-[13px] text-white/90">
            S
          </span>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-[13.5px] text-lor-text-dark">
                sam
              </span>
              <span className="text-[11px] text-lor-text-tertiary-dark">
                2:03 PM
              </span>
            </div>
            <p className="mt-0.5 text-[13.5px] text-lor-text-dark/90 leading-relaxed">
              <span className="rounded bg-merlin/15 px-1 py-0.5 font-medium text-merlin">
                @Merlin
              </span>{" "}
              why did we drop the annual plan experiment?
            </p>
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <MerlinAvatar />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-[13.5px] text-merlin">
                Merlin
              </span>
              <span className="rounded bg-merlin/15 px-1 py-px font-medium text-[9.5px] text-merlin uppercase">
                App
              </span>
            </div>
            <p className="mt-0.5 text-[13.5px] text-lor-text-dark/90 leading-relaxed">
              Conversion held flat while support load doubled, so the team
              killed it after six weeks. Priya made the call on{" "}
              <span className="font-medium text-lor-text-dark">March 3</span>{" "}
              and the pricing page reverted the same day.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <SourceChip icon={<LinearChipIcon />} label="GROW-118" />
              <SourceChip icon={<NotionChipIcon />} label="Annual plan retro" />
              <SourceChip
                icon={<Hash className="size-3 opacity-60" strokeWidth={1.75} />}
                label="growth · Mar 3"
              />
            </div>

            {/* Citation preview, as if the Notion chip is hovered */}
            <div className="mt-3 hidden w-64 rounded-xl border border-lor-border-dark bg-lor-surface-raised-dark p-3.5 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.8)] sm:block">
              <div className="flex items-center gap-2">
                <NotionChipIcon />
                <span className="font-medium text-[12px] text-lor-text-dark">
                  Annual plan retro
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-[11.5px] text-lor-text-secondary-dark leading-relaxed">
                Decision: sunset the annual experiment. Flat conversion, 2x
                support tickets on refunds. Revisit after self-serve upgrades
                ship.
              </p>
              <div className="mt-2.5 flex items-center gap-1.5 text-[10.5px] text-lor-success-dark">
                <Check className="size-3" strokeWidth={2.5} />
                Citation verified
              </div>
            </div>
          </div>
        </div>
      </div>
    </MockShell>
  )
}

export function AskChapter() {
  return (
    <Chapter
      id="merlin"
      title="Ask once."
      titleMuted="Get the answer with receipts."
      mock={<AskMock />}
      points={[
        {
          lead: "Every claim carries a citation.",
          body: "Merlin links each answer to the exact message, ticket, or doc it came from, and verifies the link before it posts.",
        },
        {
          lead: "It reads code, not just chat.",
          body: "Point it at a bug and it clones the repo, digs through the history, and reports back with file-level detail.",
        },
        {
          lead: "Ask where you already are.",
          body: "Mention @Merlin in any channel or thread and the answer lands right there, visible to everyone.",
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// 02 — Connect: the connections panel, mid-sync
// ---------------------------------------------------------------------------

type Connection = {
  icon: ReactNode
  name: string
  detail: string
  status: string
  live?: boolean
}

const CONNECTIONS: Connection[] = [
  {
    icon: <Github className="size-5 text-foreground" strokeWidth={1.5} />,
    name: "GitHub",
    detail: "acme/app · 4 repos",
    status: "Synced 2m ago",
    live: true,
  },
  {
    icon: <LinearLogo className="size-5" mode="dark" />,
    name: "Linear",
    detail: "3 teams",
    status: "Indexing 1,204 issues",
    live: true,
  },
  {
    icon: (
      <span className="flex size-5 items-center justify-center overflow-hidden rounded-[3px] bg-foreground">
        <NotionLogo className="size-5" />
      </span>
    ),
    name: "Notion",
    detail: "Product wiki · 312 pages",
    status: "Synced 1h ago",
    live: true,
  },
  {
    icon: (
      <span className="text-foreground [&_path]:fill-current">
        <DatadogLogo className="size-5" />
      </span>
    ),
    name: "Datadog",
    detail: "Monitors and incidents",
    status: "Connected",
  },
  {
    icon: (
      <span className="text-foreground [&_path]:fill-current">
        <SentryLogo className="size-5" />
      </span>
    ),
    name: "Sentry",
    detail: "2 projects",
    status: "Connected",
  },
]

function ConnectMock() {
  return (
    <MockShell>
      <div aria-hidden className="p-5 text-left md:p-6">
        <p className="font-semibold text-[14px] text-lor-text-dark">
          Connections
        </p>
        <p className="mt-0.5 text-[12px] text-lor-text-tertiary-dark">
          Everything Merlin can read from
        </p>
        <div className="mt-4 flex flex-col gap-1.5">
          {CONNECTIONS.map((connection) => (
            <div
              key={connection.name}
              className="flex items-center gap-3 rounded-xl border border-lor-border-dark/70 bg-lor-surface-dark px-3.5 py-2.5"
            >
              {connection.icon}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[13px] text-lor-text-dark">
                  {connection.name}
                </p>
                <p className="truncate text-[11.5px] text-lor-text-tertiary-dark">
                  {connection.detail}
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-[11px] text-lor-text-secondary-dark">
                <span
                  className={`size-1.5 rounded-full ${
                    connection.live
                      ? "bg-lor-success-dark"
                      : "bg-lor-text-tertiary-dark/60"
                  }`}
                />
                {connection.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </MockShell>
  )
}

export function ConnectChapter() {
  return (
    <Chapter
      id="integrations"
      title="Your tools,"
      titleMuted="one memory."
      flip
      mock={<ConnectMock />}
      points={[
        {
          lead: "Ingested as it happens.",
          body: "Issues, pull requests, docs, and incidents are indexed the moment they change, so answers are current, not stale.",
        },
        {
          lead: "One question, every tool.",
          body: "Ask what shipped last week and the answer draws on GitHub, Linear, and your channels at once.",
        },
        {
          lead: "Scoped by you.",
          body: "Decide what Merlin can read and do, channel by channel, from full access down to read-only.",
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// 03 — Remember: a memory page Merlin maintains
// ---------------------------------------------------------------------------

function RememberMock() {
  return (
    <MockShell>
      <div aria-hidden className="p-5 text-left md:p-6">
        <div className="flex items-center gap-1.5 text-[11.5px] text-lor-text-tertiary-dark">
          <FileText className="size-3.5" strokeWidth={1.75} />
          memory / decisions / pricing
        </div>
        <p className="mt-3 font-semibold text-[17px] text-lor-text-dark">
          Enterprise pricing
        </p>
        <div className="mt-3 flex flex-col gap-2.5 text-[13px] text-lor-text-dark/85 leading-relaxed">
          <p>
            ACME renews at{" "}
            <span className="font-medium text-lor-text-dark">$32k/yr</span>,
            locked in by Jacob in <span className="text-merlin">#sales</span> on
            Feb 4. Renewal date is Apr 18.
          </p>
          <p>
            Annual plan experiment sunset on Mar 3. Flat conversion, doubled
            support load.{" "}
            <span className="text-merlin">[[/decisions/annual-plan]]</span>
          </p>
          <p>
            Discounts above 15% need a second sign-off since the March pricing
            review.
          </p>
        </div>
        <div className="mt-5 flex items-center justify-between border-lor-border-dark/70 border-t pt-3.5">
          <span className="flex items-center gap-2 text-[11.5px] text-lor-text-tertiary-dark">
            <MerlinAvatar size="size-5" />
            Updated by Merlin · May 28
          </span>
          <span className="text-[11.5px] text-lor-text-tertiary-dark">
            12 sources
          </span>
        </div>
      </div>
    </MockShell>
  )
}

export function RememberChapter() {
  return (
    <Chapter
      id="memory"
      title="Decisions"
      titleMuted="stop evaporating."
      mock={<RememberMock />}
      points={[
        {
          lead: "Decisions become pages.",
          body: "When your team settles something, Merlin writes it to a memory page anyone can read, search, and correct.",
        },
        {
          lead: "Months later, still there.",
          body: "Ask in November about a call made in May and it answers like the thread happened yesterday.",
        },
        {
          lead: "Auditable, not mystical.",
          body: "Memory lives in your Postgres, in tables you can query. Nothing about what Merlin knows is hidden.",
        },
      ]}
    />
  )
}
