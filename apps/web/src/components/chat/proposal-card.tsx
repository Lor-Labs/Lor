import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  Link01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { useState } from "react"
import {
  type ChannelProposal,
  type ProposalSecretsPayload,
  useApproveProposal,
  useCanResolveProposal,
  useMessageProposal,
  useRejectProposal,
} from "@/hooks/use-proposals"
import { apiClient } from "@/lib/api-client"
import type {
  ListChannelsResponse,
  Message,
  ProposalOperation,
} from "@/lib/api-types"
import { toSearchPreviewText } from "@/lib/search-preview"

// The change-proposal card (pillar 3, reference/change-proposals.md): Merlin's
// proposed workspace configuration rendered op by op, with Approve/Reject for
// people whose authority covers the proposal's permission union. Approve may
// carry secret values the approver types here — they ride the request only.

export function ProposalCard({ message }: { message: Message }) {
  const proposal = useMessageProposal(message.channelId, message.id)
  if (!proposal) {
    return (
      <div className="mt-1.5 w-fit max-w-xl rounded-xl bg-secondary/60 px-4 py-2.5">
        <p className="text-muted-foreground text-sm leading-5 whitespace-pre-wrap">
          {toSearchPreviewText(message.content, message.mentions ?? [], {
            dropUnresolvedMentions: true,
          })}
        </p>
      </div>
    )
  }
  return <ProposalCardBody proposal={proposal} channelId={message.channelId} />
}

// Existing-channel names come from the sidebar's channels cache; created ones
// from the proposal's own create_channel ops.
function channelRefLabel(
  ref: { kind: string; id?: string; opPosition?: number },
  operations: ProposalOperation[],
  channelNames: Map<string, string>
): string {
  if (ref.kind === "created") {
    const target = operations.find((o) => o.position === ref.opPosition)
    if (target?.spec.op === "create_channel") {
      return `#${target.spec.name} (new)`
    }
    return `the channel from step ${(ref.opPosition ?? 0) + 1}`
  }
  const name = ref.id ? channelNames.get(ref.id) : undefined
  return name ? `#${name}` : "a channel"
}

function profileRefLabel(
  ref: { kind: string; id?: string; opPosition?: number } | null,
  operations: ProposalOperation[]
): string {
  if (!ref) return "the default profile"
  if (ref.kind === "created") {
    const target = operations.find((o) => o.position === ref.opPosition)
    if (target?.spec.op === "create_agent_profile") {
      return `"${target.spec.name}" (new)`
    }
    return `the profile from step ${(ref.opPosition ?? 0) + 1}`
  }
  return "an existing profile"
}

function policyTargetLabel(
  target: { kind: string; key?: string; opPosition?: number },
  operations: ProposalOperation[]
): string {
  if (target.kind === "created") {
    const op = operations.find((o) => o.position === target.opPosition)
    if (op?.spec.op === "create_custom_tool") return `tool ${op.spec.name}`
    if (op?.spec.op === "create_mcp_server") return `MCP "${op.spec.name}"`
    return `step ${(target.opPosition ?? 0) + 1}`
  }
  return target.key ?? "an action"
}

function resolverLine(spec: {
  resolverKind: "any_member" | "role" | "user"
  resolverRole?: string
  resolverUserId?: string
}): string {
  if (spec.resolverKind === "role") {
    return `approved by the ${spec.resolverRole ?? "chosen"} role`
  }
  if (spec.resolverKind === "user") return "approved by a chosen member"
  return "approved by any member"
}

// Title + detail lines for one operation. Rich blocks (instructions content,
// secret inputs) render separately in OperationRow.
function opView(
  op: ProposalOperation,
  operations: ProposalOperation[],
  channelNames: Map<string, string>
): { title: string; details: string[] } {
  const spec = op.spec
  switch (spec.op) {
    case "create_channel":
      return {
        title: `Create channel #${spec.name}`,
        details: spec.topic ? [spec.topic] : [],
      }
    case "create_webhook":
      return {
        title: `Add webhook "${spec.name}"`,
        details: [
          `in ${channelRefLabel(spec.channel, operations, channelNames)}`,
        ],
      }
    case "set_trigger":
      return {
        title: `Route "${spec.event}" events to ${channelRefLabel(spec.channel, operations, channelNames)}`,
        details: [
          [
            spec.post ? "posts to the channel" : "does not post",
            spec.remember && "saves to memory",
            spec.actInstructions && "acts on each event",
          ]
            .filter(Boolean)
            .join(" · "),
        ],
      }
    case "create_loop":
      return {
        title: `Create loop "${spec.name}"`,
        details: [
          `${describeLoopSchedule(spec.schedule, null)} in ${channelRefLabel(spec.channel, operations, channelNames)}`,
          spec.instructions,
        ],
      }
    case "update_loop": {
      const changed = [
        spec.name !== undefined && `name → "${spec.name}"`,
        spec.schedule !== undefined &&
          `schedule → ${describeLoopSchedule(spec.schedule, null)}`,
        spec.instructions !== undefined && "new instructions",
        spec.timezone !== undefined &&
          `timezone → ${spec.timezone ?? "default"}`,
        spec.endCondition !== undefined && "end condition",
      ].filter(Boolean) as string[]
      return {
        title: "Edit a loop",
        details: [changed.join(" · ") || "no changes"],
      }
    }
    case "update_instructions":
      return {
        title: "Rewrite the workspace instructions (LOR.md)",
        details: [],
      }
    case "create_agent_profile":
      return {
        title: `Create agent profile "${spec.name}"`,
        details: [
          spec.capabilities.length > 0
            ? `capabilities: ${spec.capabilities.join(", ")}`
            : "no connector capabilities",
        ],
      }
    case "assign_channel_profile":
      return {
        title: `Set ${channelRefLabel(spec.channel, operations, channelNames)} to use ${profileRefLabel(spec.profile, operations)}`,
        details: [],
      }
    case "create_custom_tool":
      return {
        title: `Create tool ${spec.name}`,
        details: [spec.description, `${spec.method} ${spec.urlTemplate}`],
      }
    case "create_mcp_server":
      return {
        title: `Add MCP server "${spec.name}"`,
        details: [
          spec.url,
          spec.authMode === "oauth"
            ? "needs OAuth sign-in after it's created"
            : "",
        ].filter(Boolean),
      }
    case "set_approval_policy":
      return {
        title: `Require approval for ${policyTargetLabel(spec.target, operations)}`,
        details: [resolverLine(spec)],
      }
  }
}

function OperationRow({
  op,
  operations,
  channelNames,
  workspaceSlug,
  showSecretInputs,
  secretValues,
  onSecretChange,
}: {
  op: ProposalOperation
  operations: ProposalOperation[]
  channelNames: Map<string, string>
  workspaceSlug: string | undefined
  showSecretInputs: boolean
  secretValues: Record<string, string>
  onSecretChange: (key: string, value: string) => void
}) {
  const { title, details } = opView(op, operations, channelNames)
  const spec = op.spec
  const secretNames =
    spec.op === "create_custom_tool" ? spec.requiredSecrets : []

  const copyUrl = (url: string) => {
    void navigator.clipboard.writeText(url).then(() => toast.success("Copied"))
  }

  return (
    <li className="flex gap-2.5">
      <span
        className={cn(
          "mt-1 size-1.5 shrink-0 rounded-full",
          op.error ? "bg-destructive" : "bg-primary/60"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5">{title}</p>
        {details.map((line) => (
          <p
            key={line}
            className="mt-0.5 line-clamp-3 text-muted-foreground text-xs leading-4"
          >
            {line}
          </p>
        ))}
        {spec.op === "update_instructions" && (
          <pre className="mt-1.5 max-h-40 overflow-y-auto rounded-md bg-secondary/60 p-2 text-xs whitespace-pre-wrap">
            {spec.content}
          </pre>
        )}
        {showSecretInputs && secretNames.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {secretNames.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate font-mono text-muted-foreground text-xs">
                  {name}
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="Paste the secret (optional — can be added later)"
                  className="h-8 text-sm"
                  value={secretValues[`${op.position}:${name}`] ?? ""}
                  onChange={(e) =>
                    onSecretChange(`${op.position}:${name}`, e.target.value)
                  }
                />
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Only you see these values — they are encrypted when the tool is
              created, and Merlin never sees them.
            </p>
          </div>
        )}
        {op.error && (
          <p className="mt-1 text-destructive text-xs">{op.error}</p>
        )}
        {op.result?.resourceId &&
          spec.op === "create_channel" &&
          workspaceSlug && (
            <Link
              to="/$workspaceSlug/$channelId"
              params={{ workspaceSlug, channelId: op.result.resourceId }}
              className="mt-1 inline-flex items-center gap-1 text-primary text-xs hover:underline"
            >
              Open #{spec.name}
            </Link>
          )}
        {op.result?.url && (
          <button
            type="button"
            onClick={() => copyUrl(op.result?.url ?? "")}
            className="mt-1 inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md bg-secondary/60 px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-secondary"
          >
            <span className="truncate">{op.result.url}</span>
            <HugeiconsIcon icon={Copy01Icon} size={12} className="shrink-0" />
          </button>
        )}
        {op.result?.setupNote && (
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-warning-foreground text-xs">
            <HugeiconsIcon
              icon={AlertCircleIcon}
              size={13}
              className="shrink-0 text-warning"
            />
            {op.result.setupNote}
          </p>
        )}
      </div>
    </li>
  )
}

function ProposalCardBody({
  proposal,
  channelId,
}: {
  proposal: ChannelProposal
  channelId: string
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const queryClient = useQueryClient()
  const approve = useApproveProposal(channelId)
  const reject = useRejectProposal(channelId)
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState("")

  // Same queries the approval card runs, deduped by react-query.
  const { data: activeMember } = useQuery({
    queryKey: ["active-workspace-member", workspaceSlug],
    queryFn: async (): Promise<{ userId: string; role: string } | null> => {
      const res = await authClient.organization.getActiveMember()
      return res.data
        ? { userId: res.data.userId as string, role: res.data.role as string }
        : null
    },
    enabled: !!workspaceSlug,
  })
  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: workspaceSlug as string },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
    enabled: !!workspaceSlug,
  })

  const canResolve = useCanResolveProposal(
    membersData?.workspaceId,
    activeMember ?? null,
    membersData?.ownerId,
    proposal.requiredPermissions
  )

  const channelsData = queryClient.getQueryData<ListChannelsResponse>([
    "channels",
    workspaceSlug,
  ])
  const channelNames = new Map<string, string>()
  for (const ch of channelsData?.uncategorized ?? []) {
    if (ch.name) channelNames.set(ch.id, ch.name)
  }
  for (const cat of channelsData?.categories ?? []) {
    for (const ch of cat.channels) {
      if (ch.name) channelNames.set(ch.id, ch.name)
    }
  }

  const resolverName =
    membersData?.members.find((m) => m.userId === proposal.resolvedByUserId)
      ?.name ?? null

  const isPending = proposal.status === "pending"
  const isApplying = proposal.status === "approved" || approve.isPending
  const busy = approve.isPending || reject.isPending

  const onApprove = () => {
    const secrets: ProposalSecretsPayload = {}
    for (const op of proposal.operations) {
      if (op.spec.op !== "create_custom_tool") continue
      const values: Record<string, string> = {}
      for (const name of op.spec.requiredSecrets) {
        const value = secretValues[`${op.position}:${name}`]?.trim()
        if (value) values[name] = value
      }
      if (Object.keys(values).length > 0) {
        secrets[String(op.position)] = values
      }
    }
    approve.mutate({
      proposalId: proposal.id,
      secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
    })
  }

  const onReject = () => {
    reject.mutate(
      { proposalId: proposal.id, note: note.trim() || undefined },
      { onSuccess: () => setRejecting(false) }
    )
  }

  const header =
    proposal.status === "applied" ? (
      <p className="flex items-center gap-1.5 font-medium text-sm text-success">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />
        Applied{resolverName ? ` — approved by ${resolverName}` : ""}
      </p>
    ) : proposal.status === "failed" ? (
      <p className="flex items-center gap-1.5 font-medium text-destructive text-sm">
        <HugeiconsIcon icon={AlertCircleIcon} size={16} />
        Couldn't apply these changes
      </p>
    ) : proposal.status === "rejected" ? (
      <p className="font-medium text-muted-foreground text-sm">
        Rejected{resolverName ? ` by ${resolverName}` : ""}
      </p>
    ) : isApplying ? (
      <p className="font-medium text-sm">Applying the changes…</p>
    ) : (
      <p className="font-medium text-sm">Merlin proposes these changes</p>
    )

  return (
    <div
      className={cn(
        "mt-1.5 max-w-xl rounded-xl border p-4",
        isPending || isApplying
          ? "border-primary/25 bg-primary/[0.04]"
          : proposal.status === "failed"
            ? "border-destructive/30 bg-destructive/5"
            : "border-border bg-secondary/30",
        proposal.status === "rejected" && "opacity-80"
      )}
    >
      {header}
      <p className="mt-1 text-muted-foreground text-sm">{proposal.rationale}</p>

      <ul className="mt-3 space-y-2.5">
        {proposal.operations.map((op) => (
          <OperationRow
            key={op.id}
            op={op}
            operations={proposal.operations}
            channelNames={channelNames}
            workspaceSlug={workspaceSlug}
            showSecretInputs={isPending && canResolve}
            secretValues={secretValues}
            onSecretChange={(key, value) =>
              setSecretValues((prev) => ({ ...prev, [key]: value }))
            }
          />
        ))}
      </ul>

      {proposal.evidence.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {proposal.evidence.map((item) =>
            item.kind === "url" ? (
              <a
                key={item.ref}
                href={item.ref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-secondary/60 px-2 py-0.5 text-muted-foreground text-xs transition-colors hover:bg-secondary hover:text-foreground"
              >
                <HugeiconsIcon icon={Link01Icon} size={12} />
                <span className="max-w-56 truncate">
                  {item.ref.replace(/^https?:\/\//, "")}
                </span>
              </a>
            ) : null
          )}
        </div>
      )}

      {proposal.status === "rejected" && proposal.resolutionNote && (
        <p className="mt-3 text-muted-foreground text-xs">
          {proposal.resolutionNote}
        </p>
      )}
      {proposal.status === "failed" && proposal.resolutionNote && (
        <p className="mt-3 text-destructive text-xs">
          {proposal.resolutionNote}
        </p>
      )}

      {isPending &&
        (canResolve ? (
          rejecting ? (
            <div className="mt-3 space-y-2">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why not? Merlin revises the proposal from this note (optional)"
                className="min-h-16 text-sm"
                maxLength={2000}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  loading={reject.isPending}
                  onClick={onReject}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setRejecting(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                disabled={busy}
                loading={approve.isPending}
                onClick={onApprove}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setRejecting(true)}
              >
                Reject
              </Button>
            </div>
          )
        ) : (
          <p className="mt-3 text-muted-foreground text-xs">
            Waiting for someone with permission to manage these settings.
          </p>
        ))}
    </div>
  )
}
