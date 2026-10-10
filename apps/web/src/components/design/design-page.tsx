import { Button } from "@repo/ui/components/button"
import { useTheme } from "next-themes"
import type { ReactNode } from "react"
import { ApprovalGateView } from "@/components/chat/approval-card"
import {
  ProposalCardFallback,
  ProposalCardView,
} from "@/components/chat/proposal-card"
import {
  APPROVAL_SAMPLES,
  PROPOSAL_SAMPLES,
  SAMPLE_CHANNEL_NAMES,
} from "@/components/design/design-samples"

// /design: every state of the cards Lor shows in a session, rendered with
// sample data inside a session turn. Buttons respond but never call the API.
export function DesignPage() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === "dark"

  return (
    <div className="h-dvh overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-12 flex items-end justify-between gap-6">
          <div>
            <h1 className="font-semibold text-xl tracking-tight">Design</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              Cards Lor shows in a session, in every state, with sample data.
              Buttons respond but never call the API.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTheme(dark ? "light" : "dark")}
          >
            {dark ? "Light mode" : "Dark mode"}
          </Button>
        </header>

        <Section title="Approval request">
          {APPROVAL_SAMPLES.map((sample) => (
            <Example
              key={sample.label}
              label={sample.label}
              lorSays={sample.lorSays}
            >
              <div className="max-w-xl">
                <ApprovalGateView
                  approval={sample.approval}
                  canResolve={sample.canResolve}
                  pending={false}
                  onResolve={() => {}}
                  resolvedByName={sample.resolvedByName ?? null}
                />
              </div>
            </Example>
          ))}
        </Section>

        <Section title="Workspace change proposal">
          {PROPOSAL_SAMPLES.map((sample) => (
            <Example
              key={sample.label}
              label={sample.label}
              lorSays={sample.lorSays}
            >
              <ProposalCardView
                proposal={sample.proposal}
                workspaceSlug={undefined}
                channelNames={SAMPLE_CHANNEL_NAMES}
                canResolve={sample.canResolve}
                resolverName={sample.resolverName ?? null}
                approving={false}
                rejectPending={false}
                onApprove={() => {}}
                onReject={(_note, done) => done()}
              />
            </Example>
          ))}
          <Example
            label="Before the proposal loads"
            lorSays="I've filed a proposal to create #support."
          >
            <ProposalCardFallback text="Proposed workspace changes: Create #support" />
          </Example>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-16">
      <h2 className="mb-6 border-border/60 border-b pb-2 font-medium text-sm">
        {title}
      </h2>
      <div className="space-y-10">{children}</div>
    </section>
  )
}

// One session turn: Lor's avatar in the gutter, a line of its reply, the card.
function Example({
  label,
  lorSays,
  children,
}: {
  label: string
  lorSays: string
  children: ReactNode
}) {
  return (
    <div>
      <p className="mb-3 text-muted-foreground text-xs">{label}</p>
      <div className="flex gap-3">
        <img
          src="/lor-icon.png"
          alt=""
          className="size-7 shrink-0 rounded-full"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-6">{lorSays}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
