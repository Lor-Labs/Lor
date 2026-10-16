import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon"
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon"
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import HashtagIcon from "@hugeicons/core-free-icons/HashtagIcon"
import Infinity01Icon from "@hugeicons/core-free-icons/Infinity01Icon"
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon"
import PlugSocketIcon from "@hugeicons/core-free-icons/PlugSocketIcon"
import Scroll01Icon from "@hugeicons/core-free-icons/Scroll01Icon"
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon"
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import WebhookIcon from "@hugeicons/core-free-icons/WebhookIcon"
import Wrench01Icon from "@hugeicons/core-free-icons/Wrench01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import {
  approvalTargetLabel,
  describeProfilePermissions,
} from "@repo/connectors"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { useQuery } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { Image } from "expo-image"
import { useRouter } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { type ReactNode, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/context/workspace-context"
import {
  type ProposalSecretsPayload,
  useApproveProposal,
  useCanResolveProposal,
  useMessageProposal,
  useRejectProposal,
} from "@/hooks/use-proposals"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import { api } from "@/lib/api"
import type {
  AgentProfilesResponse,
  ChannelProposal,
  Message,
  ProposalOperation,
} from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { env } from "@/lib/env"
import { toSearchPreviewText } from "@/lib/message-markdown"
import { openExternalUrl } from "@/lib/open-url"

// The change-proposal card (reference/change-proposals.md), after web's
// redesign: the changes themselves as the headline (applied in this order),
// one action row under them, Lor's reason behind "Why". Buttons show for
// people whose authority covers the proposal's permission union; approve may
// carry secret values the approver types here (request-only).

type IconSvg = typeof HashtagIcon

const OP_ICONS: Record<ProposalOperation["kind"], IconSvg> = {
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

// The card's frame, a quiet rounded border.
const FRAME = "mt-one w-full max-w-[520px] rounded-lor-md border border-border"

type ChannelNameSource = {
  uncategorized?: Array<{ id: string; name: string | null }>
  categories?: Array<{ channels: Array<{ id: string; name: string | null }> }>
}

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
    <Text className="bg-surface-secondary font-mono text-[13px] text-foreground">
      {" "}
      {children}{" "}
    </Text>
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
            spec.remember && "saves to memory",
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

function CopyUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      className="flex-row items-center gap-two rounded-lor-sm border border-border px-two py-two active:opacity-70"
      onPress={() => {
        void Clipboard.setStringAsync(url).then((ok) => {
          if (!ok) return
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      <Text
        className="min-w-0 flex-1 font-mono text-[11px] text-muted"
        numberOfLines={1}
      >
        {url}
      </Text>
      <Text className="text-[11px] font-semibold text-accent">
        {copied ? "Copied" : "Copy"}
      </Text>
    </Pressable>
  )
}

// One change as a plain row: icon tile, title, its details, and whatever it
// needs (secret inputs before approval, results after).
function OperationItem({
  op,
  operations,
  channelNames,
  applied,
  showSecretInputs,
  secretValues,
  onSecretChange,
}: {
  op: ProposalOperation
  operations: ProposalOperation[]
  channelNames: Map<string, string>
  applied: boolean
  showSecretInputs: boolean
  secretValues: Record<string, string>
  onSecretChange: (key: string, value: string) => void
}) {
  const router = useRouter()
  const [foreground, success, danger, fieldPlaceholder] = useThemeColor([
    "foreground",
    "success",
    "danger",
    "field-placeholder",
  ])
  const { workspace } = useWorkspace()
  const workspaceSlug = workspace?.slug
  const { data: profileData } = useQuery({
    queryKey: ["agent-profiles", workspaceSlug],
    enabled: !!workspaceSlug && op.spec.op === "create_agent_profile",
    queryFn: async () => {
      const response = await api.v1.workspaces[":workspaceSlug"][
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
  const tile = op.error
    ? { className: "bg-danger-soft", color: danger, icon: AlertCircleIcon }
    : applied
      ? { className: "bg-success-soft", color: success, icon: Tick02Icon }
      : {
          className: "bg-surface-secondary",
          color: foreground,
          // Unknown kind (newer server): generic glyph, not a crash.
          icon: (OP_ICONS[op.kind] as IconSvg | undefined) ?? SparklesIcon,
        }

  return (
    <View className="flex-row gap-three">
      <View
        className={`size-8 items-center justify-center rounded-lor-sm ${tile.className}`}
      >
        <HugeiconsIcon color={tile.color} icon={tile.icon} size={15} />
      </View>
      <View className="min-w-0 flex-1 gap-two pt-[3px]">
        <View>
          <Text className="text-sm font-medium leading-5 text-foreground">
            {title}
          </Text>
          {details.map((line) => (
            <Text
              className="text-[13px] leading-5 text-muted"
              key={line}
              numberOfLines={spec.op === "create_agent_profile" ? undefined : 2}
            >
              {line}
            </Text>
          ))}
        </View>
        {spec.op === "update_instructions" ? (
          <Text
            className="rounded-lor-sm border border-border p-two font-mono text-xs text-muted"
            numberOfLines={10}
          >
            {spec.content}
          </Text>
        ) : null}
        {showSecretInputs && secretNames.length > 0 ? (
          <View className="gap-two">
            {secretNames.map((name) => (
              <View className="gap-one" key={name}>
                <Text className="font-mono text-xs text-muted">{name}</Text>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="off"
                  className="min-h-10 rounded-lor-sm border border-border bg-surface px-two text-sm text-foreground"
                  onChangeText={(value) =>
                    onSecretChange(`${op.position}:${name}`, value)
                  }
                  placeholder="Paste the secret"
                  placeholderTextColor={fieldPlaceholder}
                  secureTextEntry
                  value={secretValues[`${op.position}:${name}`] ?? ""}
                />
              </View>
            ))}
            <Text className="text-xs leading-[18px] text-muted">
              Optional. Stored encrypted and never shown to Lor. Without it the
              tool waits for its secrets.
            </Text>
          </View>
        ) : null}
        {op.error ? (
          <Text className="text-xs leading-[18px] text-danger">{op.error}</Text>
        ) : null}
        {op.result?.resourceId && spec.op === "create_channel" ? (
          <Pressable
            accessibilityRole="link"
            className="self-start"
            onPress={() =>
              router.push({
                pathname: "/channel/[channelId]",
                params: { channelId: op.result?.resourceId ?? "" },
              })
            }
          >
            <Text className="text-xs font-medium text-accent">
              Open #{spec.name}
            </Text>
          </Pressable>
        ) : null}
        {op.result?.url ? <CopyUrlRow url={op.result.url} /> : null}
        {op.result?.setupNote ? (
          <Text className="text-xs leading-[18px] text-warning">
            {op.result.setupNote}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

// One research link Lor filed with the proposal: the site's favicon (through
// our /v1/favicon proxy, never the third-party url directly) and hostname.
function SourceBadge({ href }: { href: string }) {
  const muted = useThemeColor("muted")
  const [failed, setFailed] = useState(false)
  let host: string
  try {
    host = new URL(href).hostname
  } catch {
    return null
  }
  return (
    <Pressable
      accessibilityLabel={`Open ${host}`}
      accessibilityRole="link"
      className="min-h-7 flex-row items-center gap-[6px] rounded-full border border-border py-one pl-[6px] pr-two active:opacity-70"
      onPress={() => openExternalUrl(href)}
    >
      <View className="size-4 items-center justify-center rounded-[4px] bg-surface-secondary">
        {failed ? (
          <HugeiconsIcon color={muted} icon={Link01Icon} size={10} />
        ) : (
          <Image
            onError={() => setFailed(true)}
            source={{
              uri: `${env.EXPO_PUBLIC_API_URL}/v1/favicon/${encodeURIComponent(host)}`,
            }}
            style={{ width: 12, height: 12, borderRadius: 2 }}
          />
        )}
      </View>
      <Text className="text-xs font-medium text-muted" numberOfLines={1}>
        {host.replace(/^www\./, "")}
      </Text>
    </Pressable>
  )
}

// The action row's status mark: a dot while it waits, an icon once something
// happened.
function StatusMark({ status }: { status: ChannelProposal["status"] }) {
  const [muted, success, danger] = useThemeColor(["muted", "success", "danger"])
  if (status === "pending") {
    return <View className="size-1.5 rounded-full bg-warning" />
  }
  if (status === "approved") {
    return (
      <ActivityIndicator
        color={muted}
        size="small"
        style={{ transform: [{ scale: 0.55 }] }}
      />
    )
  }
  const mark =
    status === "applied"
      ? { icon: Tick02Icon, color: success }
      : status === "failed"
        ? { icon: AlertCircleIcon, color: danger }
        : { icon: Cancel01Icon, color: muted }
  return <HugeiconsIcon color={mark.color} icon={mark.icon} size={12} />
}

export function ProposalCard({ message }: { message: Message }) {
  const proposal = useMessageProposal(message.channelId, message.id)
  if (!proposal) {
    return (
      <View className={`${FRAME} self-start px-three py-two`}>
        <Text className="text-[13px] leading-5 text-muted" numberOfLines={2}>
          {toSearchPreviewText(message.content, message.mentions)}
        </Text>
      </View>
    )
  }
  return <ProposalCardBody proposal={proposal} />
}

function ProposalCardBody({ proposal }: { proposal: ChannelProposal }) {
  const { workspace } = useWorkspace()
  const { data: auth } = authClient.useSession()
  const approve = useApproveProposal(proposal.channelId)
  const reject = useRejectProposal(proposal.channelId)
  const canResolve = useCanResolveProposal(proposal.requiredPermissions)
  const members = useWorkspaceMembers(workspace?.slug ?? "")
  const fieldPlaceholder = useThemeColor("field-placeholder")
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState(false)
  const [showWhy, setShowWhy] = useState(false)
  const [rejectNote, setRejectNote] = useState("")

  // Subscribed read of the channel list another screen fetched (enabled:false
  // never fetches) — labels refresh when that cache fills or updates.
  const { data: channelsData } = useQuery<ChannelNameSource>({
    queryKey: ["channels", workspace?.slug],
    enabled: false,
  })
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
    proposal.resolvedByUserId === auth?.user.id
      ? "you"
      : (members.members.find((m) => m.userId === proposal.resolvedByUserId)
          ?.name ?? null)
  const isPending = proposal.status === "pending"
  const isApplied = proposal.status === "applied"
  const busy = approve.isPending || reject.isPending
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
  const sources = proposal.evidence.filter((item) => item.kind === "url")

  const onApprove = () => {
    const secrets: ProposalSecretsPayload = {}
    for (const op of proposal.operations) {
      if (op.spec.op !== "create_custom_tool") continue
      const values: Record<string, string> = {}
      for (const name of op.spec.requiredSecrets) {
        const value = secretValues[`${op.position}:${name}`]?.trim()
        if (value) values[name] = value
      }
      if (Object.keys(values).length > 0) secrets[String(op.position)] = values
    }
    approve.mutate({
      proposalId: proposal.id,
      secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
    })
  }

  // One surface, no dividers: the change is the headline, one action row
  // under it. Lor's message above already says why, so the reason and its
  // sources wait behind "Why". Indented rows line up past the icon tiles.
  return (
    <View className={`${FRAME} p-three`}>
      <View className="gap-three">
        {proposal.operations.map((op) => (
          <OperationItem
            applied={isApplied}
            channelNames={channelNames}
            key={op.id}
            onSecretChange={(key, value) =>
              setSecretValues((prev) => ({ ...prev, [key]: value }))
            }
            op={op}
            operations={proposal.operations}
            secretValues={secretValues}
            showSecretInputs={showActions}
          />
        ))}
      </View>

      {note ? (
        <Text
          className={`ml-[44px] mt-three border-l-2 pl-two text-[13px] leading-5 ${
            proposal.status === "failed"
              ? "border-danger text-danger"
              : "border-border text-muted"
          }`}
        >
          {note}
        </Text>
      ) : null}

      {showWhy ? (
        <View className="ml-[44px] mt-three gap-two rounded-lor-sm bg-surface-secondary px-three py-two">
          <Text className="text-[13px] leading-5 text-muted">
            {proposal.rationale}
          </Text>
          {sources.length > 0 ? (
            <View className="flex-row flex-wrap items-center gap-[6px]">
              <Text className="text-xs text-muted opacity-70">Sources</Text>
              {sources.map((item) => (
                <SourceBadge href={item.ref} key={item.ref} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {showActions && rejecting ? (
        <View className="ml-[44px] mt-three gap-two">
          <TextInput
            className="min-h-16 rounded-lor-sm border border-border bg-surface px-two py-two text-sm text-foreground"
            maxLength={2000}
            multiline
            onChangeText={setRejectNote}
            placeholder="What should Lor change? (optional)"
            placeholderTextColor={fieldPlaceholder}
            value={rejectNote}
          />
          <View className="flex-row justify-end gap-two">
            <Button
              isDisabled={busy}
              onPress={() => setRejecting(false)}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              isDisabled={busy}
              onPress={() => {
                // The card shows the rejection at once, so the note box
                // closes now.
                reject.mutate({
                  proposalId: proposal.id,
                  note: rejectNote.trim() || undefined,
                })
                setRejecting(false)
              }}
              size="sm"
              variant="danger"
            >
              Reject
            </Button>
          </View>
        </View>
      ) : (
        <View className="ml-[44px] mt-three min-h-8 flex-row flex-wrap items-center gap-x-two gap-y-two">
          <View className="min-w-0 flex-row items-center gap-[6px]">
            <StatusMark status={proposal.status} />
            <Text className="text-xs text-muted" numberOfLines={1}>
              {statusText}
            </Text>
          </View>
          <Text className="text-xs text-muted opacity-40">·</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showWhy }}
            hitSlop={8}
            onPress={() => setShowWhy((current) => !current)}
          >
            <Text className="text-xs text-muted opacity-70">
              {showWhy ? "Hide why" : "Why"}
            </Text>
          </Pressable>
          {showActions ? (
            <View className="ml-auto flex-row gap-two">
              <Button
                isDisabled={busy}
                onPress={() => setRejecting(true)}
                size="sm"
                variant="ghost"
              >
                Reject
              </Button>
              <Button isDisabled={busy} onPress={onApprove} size="sm">
                Approve
              </Button>
            </View>
          ) : null}
        </View>
      )}
    </View>
  )
}
