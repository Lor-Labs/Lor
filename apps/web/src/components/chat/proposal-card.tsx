import {
  Alert01Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowRight02Icon,
  Cancel01Icon,
  Copy01Icon,
  HashtagIcon,
  Infinity01Icon,
  Link01Icon,
  Loading03Icon,
  PlugSocketIcon,
  Scroll01Icon,
  Shield01Icon,
  SparklesIcon,
  Tick02Icon,
  WebhookIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { env } from "@repo/env/client"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
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

// The change-proposal surface (pillar 3, reference/change-proposals.md):
// Lor's proposed workspace configuration as a timeline — one indicator per
// operation on a connecting rail, applied in this order. Deliberately NOT a
// card: no border or fill of its own, it renders straight into the channel
// like the reui timeline references; only the per-step panels are framed.
// Approve/Reject show for people whose authority covers the proposal's
// permission union; approve may carry secret values the approver types here
// (request-only).
const SURFACE_CLASS = "mt-1.5 w-full max-w-xl"

type IconSvgObject = typeof HashtagIcon

const OP_ICONS: Record<ProposalOperation["kind"], IconSvgObject> = {
  create_channel: HashtagIcon,
  create_webhook: WebhookIcon,
  set_trigger: ArrowRight02Icon,
  create_loop: Infinity01Icon,
  update_loop: Infinity01Icon,
  update_instructions: Scroll01Icon,
  create_agent_profile: SparklesIcon,
  assign_channel_profile: SparklesIcon,
  create_custom_tool: Wrench01Icon,
  create_mcp_server: PlugSocketIcon,
  set_approval_policy: Shield01Icon,
}

const STATUS_BADGE: Record<
  Exclude<ChannelProposal["status"], "applied">,
  {
    label: string
    variant: "info" | "warning" | "error" | "secondary"
    icon: IconSvgObject
    spin?: boolean
  }
> = {
  pending: { label: "Needs approval", variant: "warning", icon: Alert01Icon },
  approved: {
    label: "Applying",
    variant: "info",
    icon: Loading03Icon,
    spin: true,
  },
  failed: { label: "Failed", variant: "error", icon: AlertCircleIcon },
  rejected: { label: "Rejected", variant: "secondary", icon: Cancel01Icon },
}

export function ProposalCard({ message }: { message: Message }) {
  const proposal = useMessageProposal(message.channelId, message.id)
  if (!proposal) {
    return (
      <div className="mt-1.5 w-fit max-w-xl rounded-xl bg-secondary/60 px-4 py-2.5">
        <p className="line-clamp-2 text-muted-foreground text-sm leading-5">
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
// secret inputs) render separately in OperationItem.
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
          spec.authMode === "oauth" ? "OAuth sign-in after it's created" : "",
        ].filter(Boolean),
      }
    case "set_approval_policy":
      return {
        title: `Require approval for ${policyTargetLabel(spec.target, operations)}`,
        details: [resolverLine(spec)],
      }
    // An op kind this client build doesn't know yet (server deployed ahead):
    // render its raw name rather than crashing the card.
    default:
      return {
        title: String((spec as { op: string }).op).replaceAll("_", " "),
        details: [],
      }
  }
}

function OperationItem({
  op,
  operations,
  channelNames,
  workspaceSlug,
  applied,
  isLast,
  defaultOpen,
  showSecretInputs,
  secretValues,
  onSecretChange,
}: {
  op: ProposalOperation
  operations: ProposalOperation[]
  channelNames: Map<string, string>
  workspaceSlug: string | undefined
  applied: boolean
  isLast: boolean
  defaultOpen: boolean
  showSecretInputs: boolean
  secretValues: Record<string, string>
  onSecretChange: (key: string, value: string) => void
}) {
  const { title, details } = opView(op, operations, channelNames)
  const spec = op.spec
  const secretNames =
    spec.op === "create_custom_tool" ? spec.requiredSecrets : []

  const copyUrl = (url: string) => {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Copied"))
      .catch(() => toast.error("Couldn't copy — select the URL manually"))
  }

  // The first detail line doubles as the panel's always-visible header; the
  // rest collapses behind it.
  const headerLine = details[0] ?? null
  const bodyDetails = details.slice(1)
  const hasBody =
    bodyDetails.length > 0 ||
    spec.op === "update_instructions" ||
    (showSecretInputs && secretNames.length > 0) ||
    Boolean(op.error) ||
    Boolean(op.result?.url) ||
    Boolean(op.result?.setupNote) ||
    Boolean(op.result?.resourceId && spec.op === "create_channel")
  const [open, setOpen] = useState(defaultOpen)

  const body = hasBody ? (
    <div className="space-y-2 px-3 pb-2.5">
      {bodyDetails.map((line) => (
        <p
          key={line}
          className="line-clamp-2 text-[13px] text-muted-foreground leading-5"
        >
          {line}
        </p>
      ))}
      {spec.op === "update_instructions" && (
        <pre className="max-h-36 overflow-y-auto rounded-md bg-background/60 p-2.5 font-mono text-muted-foreground text-xs whitespace-pre-wrap">
          {spec.content}
        </pre>
      )}
      {showSecretInputs && secretNames.length > 0 && (
        <div className="space-y-1.5">
          {secretNames.map((name) => (
            <div key={name} className="flex items-center gap-2">
              <span className="w-36 shrink-0 truncate font-mono text-muted-foreground text-xs">
                {name}
              </span>
              <Input
                type="password"
                autoComplete="off"
                placeholder="Paste the secret"
                className="h-8 text-sm"
                value={secretValues[`${op.position}:${name}`] ?? ""}
                onChange={(e) =>
                  onSecretChange(`${op.position}:${name}`, e.target.value)
                }
              />
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Optional — added encrypted, never shown to Lor. Skipping leaves the
            tool waiting for its secrets.
          </p>
        </div>
      )}
      {op.error && (
        <p className="text-[13px] text-destructive leading-5">{op.error}</p>
      )}
      {op.result?.resourceId &&
        spec.op === "create_channel" &&
        workspaceSlug && (
          <Link
            to="/$workspaceSlug/$channelId"
            params={{ workspaceSlug, channelId: op.result.resourceId }}
            className="inline-flex items-center gap-1 font-medium text-[13px] text-primary hover:underline"
          >
            Open #{spec.name}
          </Link>
        )}
      {op.result?.url && (
        <button
          type="button"
          onClick={() => copyUrl(op.result?.url ?? "")}
          className="flex w-full max-w-full cursor-pointer items-center gap-2 rounded-md bg-background/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="min-w-0 truncate">{op.result.url}</span>
          <HugeiconsIcon
            icon={Copy01Icon}
            size={13}
            className="ml-auto shrink-0"
          />
        </button>
      )}
      {op.result?.setupNote && (
        <p className="flex items-start gap-1.5 text-[13px] text-warning leading-5">
          <HugeiconsIcon
            icon={AlertCircleIcon}
            size={14}
            className="mt-[3px] shrink-0"
          />
          {op.result.setupNote}
        </p>
      )}
    </div>
  ) : null

  return (
    <li className="flex gap-3.5">
      {/* Indicator + rail as flow layout: the rail is a flex-1 column filler,
          so it always spans exactly from this circle to the next. */}
      <div className="flex shrink-0 flex-col items-center">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            op.error
              ? "bg-destructive/15 text-destructive"
              : applied
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground ring-2 ring-border"
          )}
        >
          <HugeiconsIcon
            icon={
              op.error
                ? AlertCircleIcon
                : applied
                  ? Tick02Icon
                  : // Unknown kind (newer server): generic glyph, not a crash.
                    ((OP_ICONS[op.kind] as IconSvgObject | undefined) ??
                    SparklesIcon)
            }
            size={13}
            strokeWidth={2}
          />
        </span>
        {!isLast && (
          <div className="mt-1 mb-1 w-0.5 flex-1 rounded-full bg-border" />
        )}
      </div>

      <div className={cn("min-w-0 flex-1", !isLast && "pb-4")}>
        <p className="pt-0.5 font-semibold text-sm leading-5">{title}</p>
        {(headerLine || hasBody) && (
          <div className="mt-1.5 rounded-lg border border-border/60 bg-secondary/30">
            {hasBody ? (
              <Collapsible open={open} onOpenChange={setOpen}>
                <CollapsibleTrigger className="group/op flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground leading-5">
                    {headerLine ?? "Details"}
                  </span>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={15}
                    className={cn(
                      "shrink-0 text-muted-foreground/50 group-hover/op:text-muted-foreground",
                      "motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out",
                      open && "rotate-180"
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="transition-[height,opacity] duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0">
                  {body}
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <p className="truncate px-3 py-2 text-[13px] text-muted-foreground leading-5">
                {headerLine}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

// One research link Lor filed with the proposal, as a branded badge: the
// site's favicon (through our /v1/favicon proxy, never the third-party url
// directly) on a rounded plate + the hostname. A failed favicon falls back to
// the generic link glyph rather than an empty square.
function SourceBadge({ href }: { href: string }) {
  const [failed, setFailed] = useState(false)
  let host: string
  try {
    host = new URL(href).hostname
  } catch {
    return null
  }
  const label = host.replace(/^www\./, "")
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 py-1 pr-2.5 pl-1.5 text-muted-foreground text-xs transition-colors hover:bg-secondary hover:text-foreground"
    >
      <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-muted ring-1 ring-border ring-inset">
        {failed ? (
          <HugeiconsIcon icon={Link01Icon} size={10} />
        ) : (
          <img
            src={`${env.NEXT_PUBLIC_API_URL}/v1/favicon/${encodeURIComponent(host)}`}
            alt=""
            loading="lazy"
            className="size-3 rounded-[2px] object-contain"
            onError={() => setFailed(true)}
          />
        )}
      </span>
      <span className="max-w-44 truncate font-medium">{label}</span>
    </a>
  )
}

function EvidenceSources({
  evidence,
}: {
  evidence: ChannelProposal["evidence"]
}) {
  const urls = evidence.filter((item) => item.kind === "url")
  if (urls.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-muted-foreground/70 text-xs">Sources</span>
      {urls.map((item) => (
        <SourceBadge key={item.ref} href={item.ref} />
      ))}
    </div>
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
  const isApplied = proposal.status === "applied"
  const busy = approve.isPending || reject.isPending
  const opCount = proposal.operations.length

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

  const badge =
    proposal.status === "applied" ? null : STATUS_BADGE[proposal.status]

  return (
    <div className={SURFACE_CLASS}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-pretty font-medium text-sm leading-5">
            {opCount === 1
              ? "Workspace change"
              : `${opCount} workspace changes`}
          </p>
          <p
            className={cn(
              "text-pretty text-muted-foreground text-sm leading-5",
              !isPending && "line-clamp-2"
            )}
          >
            {proposal.rationale}
          </p>
        </div>
        {/* Applied needs no header ornament — the check-filled indicators and
            the "Approved by" footer already say it. */}
        {badge && (
          <Badge variant={badge.variant} size="sm" className="shrink-0">
            <HugeiconsIcon
              icon={badge.icon}
              size={12}
              className={badge.spin ? "animate-spin" : undefined}
            />
            {badge.label}
          </Badge>
        )}
      </div>

      <div>
        <ol className="mt-3.5">
          {proposal.operations.map((op, index) => (
            <OperationItem
              key={op.id}
              op={op}
              operations={proposal.operations}
              channelNames={channelNames}
              workspaceSlug={workspaceSlug}
              applied={isApplied}
              isLast={index === proposal.operations.length - 1}
              defaultOpen
              showSecretInputs={isPending && canResolve}
              secretValues={secretValues}
              onSecretChange={(key, value) =>
                setSecretValues((prev) => ({ ...prev, [key]: value }))
              }
            />
          ))}
        </ol>

        <EvidenceSources evidence={proposal.evidence} />

        {isApplied && resolverName && (
          <p className="mt-3 text-muted-foreground text-xs">
            Approved by {resolverName}
          </p>
        )}
        {proposal.status === "rejected" && (
          <p className="mt-3 text-muted-foreground text-xs">
            {resolverName ? `Rejected by ${resolverName}` : "Rejected"}
            {proposal.resolutionNote ? ` — ${proposal.resolutionNote}` : ""}
          </p>
        )}
        {proposal.status === "failed" && proposal.resolutionNote && (
          <p className="mt-3 text-destructive text-xs">
            {proposal.resolutionNote}
          </p>
        )}

        {isPending &&
          (canResolve ? (
            <div className="mt-4">
              {rejecting ? (
                <div className="space-y-2">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Why not? Lor revises from this note (optional)"
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
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="active:scale-[0.98]"
                    disabled={busy}
                    loading={approve.isPending}
                    onClick={onApprove}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="active:scale-[0.98]"
                    disabled={busy}
                    onClick={() => setRejecting(true)}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-muted-foreground text-xs">
              Waiting for someone with permission to approve.
            </p>
          ))}
      </div>
    </div>
  )
}
