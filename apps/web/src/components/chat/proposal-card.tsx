import {
  AlertCircleIcon,
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
import {
  approvalTargetLabel,
  describeProfilePermissions,
} from "@repo/connectors"
import { env } from "@repo/env/client"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
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
  AgentProfilesResponse,
  ListChannelsResponse,
  Message,
  ProposalOperation,
} from "@/lib/api-types"
import { toSearchPreviewText } from "@/lib/search-preview"

// The change-proposal surface (pillar 3, reference/change-proposals.md):
// the changes themselves as the headline (applied in this order), one action
// row under them, Lor's reason behind "Why". Buttons show for people whose
// authority covers the proposal's permission union; approve may carry secret
// values the approver types here (request-only).
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

// The action row's status mark: a breathing dot while it waits, an icon once
// something happened.
const STATUS_MARK: Record<
  ChannelProposal["status"],
  { icon: IconSvgObject | null; className: string; spin?: boolean }
> = {
  pending: { icon: null, className: "text-muted-foreground" },
  approved: {
    icon: Loading03Icon,
    className: "text-muted-foreground",
    spin: true,
  },
  applied: { icon: Tick02Icon, className: "text-success-foreground" },
  failed: { icon: AlertCircleIcon, className: "text-destructive-foreground" },
  rejected: { icon: Cancel01Icon, className: "text-muted-foreground" },
}

const FRAME_CLASS =
  "rounded-xl border border-border/60 bg-card dark:bg-foreground/[0.025]"

export function ProposalCard({ message }: { message: Message }) {
  const proposal = useMessageProposal(message.channelId, message.id)
  if (!proposal) {
    return (
      <ProposalCardFallback
        text={toSearchPreviewText(message.content, message.mentions ?? [], {
          dropUnresolvedMentions: true,
        })}
      />
    )
  }
  return <ProposalCardBody proposal={proposal} channelId={message.channelId} />
}

// The card's plain-text line before its proposal row loads.
export function ProposalCardFallback({ text }: { text: string }) {
  return (
    <div className={cn("mt-1.5 w-fit max-w-xl px-3 py-2.5", FRAME_CLASS)}>
      <p className="line-clamp-2 text-[13px] text-muted-foreground leading-5">
        {text}
      </p>
    </div>
  )
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
  operations: ProposalOperation[],
  profileData: AgentProfilesResponse | undefined
): string {
  if (target.kind === "created") {
    const op = operations.find((o) => o.position === target.opPosition)
    if (op?.spec.op === "create_custom_tool") return `tool ${op.spec.name}`
    return `step ${(target.opPosition ?? 0) + 1}`
  }
  return target.key
    ? approvalTargetLabel(target.key, profileData?.availableToolGroups)
    : "a tool"
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

// A name in a change's title, styled like inline code in a message.
function Name({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 font-[450] font-mono text-xs">
      {children}
    </code>
  )
}

// Title + detail lines for one operation. Rich blocks (instructions content,
// secret inputs) render separately in OperationItem.
function opView(
  op: ProposalOperation,
  operations: ProposalOperation[],
  channelNames: Map<string, string>,
  profileData?: AgentProfilesResponse
): { title: ReactNode; details: string[] } {
  const spec = op.spec
  switch (spec.op) {
    case "create_channel":
      return {
        title: (
          <>
            Create channel <Name>#{spec.name}</Name>
          </>
        ),
        details: spec.topic ? [spec.topic] : [],
      }
    case "create_webhook":
      return {
        title: (
          <>
            Add webhook <Name>{spec.name}</Name>
          </>
        ),
        details: [
          `in ${channelRefLabel(spec.channel, operations, channelNames)}`,
        ],
      }
    case "set_trigger":
      return {
        title: (
          <>
            Route <Name>{spec.event}</Name> events to{" "}
            <Name>
              {channelRefLabel(spec.channel, operations, channelNames)}
            </Name>
          </>
        ),
        details: [
          [
            spec.post ? "posts to the channel" : "does not post",
            spec.actInstructions && "acts on each event",
          ]
            .filter(Boolean)
            .join(" · "),
        ],
      }
    case "create_loop":
      return {
        title: (
          <>
            Create loop <Name>{spec.name}</Name>
          </>
        ),
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
        title: (
          <>
            Rewrite the workspace instructions <Name>LOR.md</Name>
          </>
        ),
        details: [],
      }
    case "create_agent_profile":
      return {
        title: (
          <>
            Create agent profile <Name>{spec.name}</Name>
          </>
        ),
        details: describeProfilePermissions(
          spec,
          profileData?.availableToolGroups,
          new Map(
            operations.flatMap((operation) =>
              operation.spec.op === "create_custom_tool"
                ? [[operation.position, operation.spec.name] as const]
                : []
            )
          )
        ),
      }
    case "assign_channel_profile":
      return {
        title: (
          <>
            Set{" "}
            <Name>
              {channelRefLabel(spec.channel, operations, channelNames)}
            </Name>{" "}
            to use {profileRefLabel(spec.profile, operations)}
          </>
        ),
        details: [],
      }
    case "create_custom_tool":
      return {
        title: (
          <>
            Create tool <Name>{spec.name}</Name>
          </>
        ),
        details: [spec.description, `${spec.method} ${spec.urlTemplate}`],
      }
    case "create_mcp_server":
      return {
        title: (
          <>
            Add MCP server <Name>{spec.name}</Name>
          </>
        ),
        details: [
          spec.url,
          spec.authMode === "oauth" ? "OAuth sign-in after it's created" : "",
        ].filter(Boolean),
      }
    case "set_approval_policy":
      return {
        title: (
          <>
            Require approval for{" "}
            <Name>
              {policyTargetLabel(spec.target, operations, profileData)}
            </Name>
          </>
        ),
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

// One change as a plain row: icon, title, its details, and whatever it needs
// (secret inputs before approval, results after).
function OperationItem({
  op,
  operations,
  channelNames,
  workspaceSlug,
  applied,
  showSecretInputs,
  secretValues,
  onSecretChange,
}: {
  op: ProposalOperation
  operations: ProposalOperation[]
  channelNames: Map<string, string>
  workspaceSlug: string | undefined
  applied: boolean
  showSecretInputs: boolean
  secretValues: Record<string, string>
  onSecretChange: (key: string, value: string) => void
}) {
  const { data: profileData } = useQuery({
    queryKey: ["agent-profiles", workspaceSlug],
    enabled: !!workspaceSlug && op.spec.op === "create_agent_profile",
    queryFn: async () => {
      const response = await apiClient.v1.workspaces[":workspaceSlug"][
        "agent-profiles"
      ].$get({ param: { workspaceSlug: workspaceSlug ?? "" } })
      if (!response.ok) throw new Error("Could not load profile tools")
      return response.json()
    },
  })
  const { title, details } = opView(op, operations, channelNames, profileData)
  const spec = op.spec
  const secretNames =
    spec.op === "create_custom_tool" ? spec.requiredSecrets : []

  const copyUrl = (url: string) => {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Copied"))
      .catch(() => toast.error("Couldn't copy — select the URL manually"))
  }

  const icon = op.error
    ? AlertCircleIcon
    : applied
      ? Tick02Icon
      : // Unknown kind (newer server): generic glyph, not a crash.
        ((OP_ICONS[op.kind] as IconSvgObject | undefined) ?? SparklesIcon)

  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-300",
          op.error
            ? "bg-destructive/12 text-destructive-foreground"
            : applied
              ? "bg-success/12 text-success-foreground"
              : "bg-muted text-foreground/70"
        )}
      >
        <HugeiconsIcon icon={icon} size={15} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-[3px]">
        <div>
          <p className="font-medium text-sm leading-5">{title}</p>
          {details.map((line) => (
            <p
              key={line}
              className={cn(
                "break-words text-[13px] text-muted-foreground leading-5",
                spec.op !== "create_agent_profile" && "line-clamp-2"
              )}
            >
              {line}
            </p>
          ))}
        </div>
        {spec.op === "update_instructions" && (
          <pre className="max-h-36 overflow-y-auto rounded-lg border border-border/60 bg-background/60 p-2.5 font-mono text-muted-foreground text-xs whitespace-pre-wrap">
            {spec.content}
          </pre>
        )}
        {showSecretInputs && secretNames.length > 0 && (
          <div className="space-y-2.5">
            {secretNames.map((name) => (
              <div key={name} className="space-y-1">
                <label
                  htmlFor={`secret-${op.id}-${name}`}
                  className="block truncate font-mono text-muted-foreground text-xs"
                >
                  {name}
                </label>
                <Input
                  id={`secret-${op.id}-${name}`}
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
            <p className="text-muted-foreground text-xs leading-[18px]">
              Optional. Stored encrypted and never shown to Lor. Without it the
              tool waits for its secrets.
            </p>
          </div>
        )}
        {op.error && (
          <p className="text-destructive-foreground text-xs leading-[18px]">
            {op.error}
          </p>
        )}
        {op.result?.resourceId &&
          spec.op === "create_channel" &&
          workspaceSlug && (
            <Link
              to="/$workspaceSlug/$channelId"
              params={{ workspaceSlug, channelId: op.result.resourceId }}
              className="inline-flex items-center gap-1 font-medium text-primary text-xs hover:underline"
            >
              Open #{spec.name}
            </Link>
          )}
        {op.result?.url && (
          <button
            type="button"
            onClick={() => copyUrl(op.result?.url ?? "")}
            className="flex w-full max-w-full cursor-pointer items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
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
          <p className="flex items-start gap-1.5 text-warning-foreground text-xs leading-[18px]">
            <HugeiconsIcon
              icon={AlertCircleIcon}
              size={13}
              className="mt-[2px] shrink-0"
            />
            {op.result.setupNote}
          </p>
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
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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

  return (
    <ProposalCardView
      proposal={proposal}
      workspaceSlug={workspaceSlug}
      channelNames={channelNames}
      canResolve={canResolve}
      resolverName={resolverName}
      approving={approve.isPending}
      rejectPending={reject.isPending}
      onApprove={(secrets) =>
        approve.mutate({ proposalId: proposal.id, secrets })
      }
      onReject={(note, done) => {
        if (!activeMember) return
        // The card shows the rejection at once, so the note box closes now.
        reject.mutate({
          proposalId: proposal.id,
          note,
          userId: activeMember.userId,
        })
        done()
      }}
    />
  )
}

// The card itself, data in and callbacks out (the /design page renders it
// with sample data).
export function ProposalCardView({
  proposal,
  workspaceSlug,
  channelNames,
  canResolve,
  resolverName,
  approving,
  rejectPending,
  onApprove: approve,
  onReject: reject,
}: {
  proposal: ChannelProposal
  workspaceSlug: string | undefined
  channelNames: Map<string, string>
  canResolve: boolean
  resolverName: string | null
  approving: boolean
  rejectPending: boolean
  onApprove: (secrets: ProposalSecretsPayload | undefined) => void
  onReject: (note: string | undefined, done: () => void) => void
}) {
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState(false)
  const [showWhy, setShowWhy] = useState(false)
  const [rejectNote, setRejectNote] = useState("")

  const isPending = proposal.status === "pending"
  const isApplied = proposal.status === "applied"
  const busy = approving || rejectPending

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
    approve(Object.keys(secrets).length > 0 ? secrets : undefined)
  }

  const onReject = () => {
    reject(rejectNote.trim() || undefined, () => setRejecting(false))
  }

  const mark = STATUS_MARK[proposal.status]
  const showActions = isPending && canResolve
  const statusText = isPending
    ? canResolve
      ? "Needs your approval"
      : "Waiting for someone who can approve"
    : proposal.status === "approved"
      ? "Applying"
      : isApplied
        ? resolverName
          ? `Approved by ${resolverName}`
          : "Applied"
        : proposal.status === "rejected"
          ? resolverName
            ? `Rejected by ${resolverName}`
            : "Rejected"
          : "Couldn't apply"
  // A reject note or an apply failure, quoted under the changes.
  const note =
    proposal.status === "rejected" || proposal.status === "failed"
      ? proposal.resolutionNote
      : null

  // One surface, no dividers: the change is the headline, one action row
  // under it. Lor's message above already says why, so the reason and its
  // sources wait behind "Why".
  return (
    <div className={cn("mt-1.5 w-full max-w-lg p-3", FRAME_CLASS)}>
      <ol className="space-y-3">
        {proposal.operations.map((op) => (
          <OperationItem
            key={op.id}
            op={op}
            operations={proposal.operations}
            channelNames={channelNames}
            workspaceSlug={workspaceSlug}
            applied={isApplied}
            showSecretInputs={showActions}
            secretValues={secretValues}
            onSecretChange={(key, value) =>
              setSecretValues((prev) => ({ ...prev, [key]: value }))
            }
          />
        ))}
      </ol>

      {note && (
        <p
          className={cn(
            "mt-3 ms-11 border-l-2 ps-2.5 text-[13px] leading-5",
            proposal.status === "failed"
              ? "border-destructive/40 text-destructive-foreground"
              : "border-border text-muted-foreground"
          )}
        >
          {note}
        </p>
      )}

      {showWhy && (
        <div className="mt-3 ms-11 space-y-2.5 rounded-lg bg-muted/40 px-3 py-2.5">
          <p className="text-[13px] text-muted-foreground leading-5">
            {proposal.rationale}
          </p>
          <EvidenceSources evidence={proposal.evidence} />
        </div>
      )}

      {showActions && rejecting ? (
        <div className="mt-3 ms-11 space-y-2">
          <Textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="What should Lor change? (optional)"
            className="min-h-16 text-sm"
            maxLength={2000}
          />
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              loading={rejectPending}
              onClick={onReject}
            >
              Reject
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 ms-11 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-2">
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-xs",
              mark.className
            )}
          >
            {mark.icon ? (
              <HugeiconsIcon
                icon={mark.icon}
                size={12}
                strokeWidth={2}
                className={mark.spin ? "animate-spin" : undefined}
              />
            ) : (
              <span className="size-1.5 shrink-0 rounded-full bg-warning motion-safe:animate-pulse" />
            )}
            <span className="truncate">{statusText}</span>
          </span>
          <span aria-hidden="true" className="text-muted-foreground/40 text-xs">
            ·
          </span>
          <button
            type="button"
            aria-expanded={showWhy}
            onClick={() => setShowWhy(!showWhy)}
            className="cursor-pointer text-muted-foreground/70 text-xs transition-colors hover:text-foreground"
          >
            {showWhy ? "Hide why" : "Why"}
          </button>
          {showActions && (
            <div className="ms-auto flex shrink-0 gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setRejecting(true)}
              >
                Reject
              </Button>
              <Button
                size="sm"
                disabled={busy}
                loading={approving}
                onClick={onApprove}
              >
                Approve
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
