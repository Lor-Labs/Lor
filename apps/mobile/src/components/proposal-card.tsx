import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon"
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon"
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
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { useQuery } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { useRouter } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Pressable, Text, TextInput, View } from "react-native"
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
import type {
  ChannelProposal,
  Message,
  ProposalOperation,
} from "@/lib/api-types"

// Mobile mirror of web's change-proposal timeline (pillar 3,
// reference/change-proposals.md). Step details stay expanded — no collapse on
// mobile. Approver-typed secrets ride the approve request only.

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

const STATUS_META: Record<
  Exclude<ChannelProposal["status"], "applied">,
  { label: string; container: string; text: string }
> = {
  pending: {
    label: "Needs approval",
    container: "bg-warning-soft",
    text: "text-warning-soft-foreground",
  },
  approved: {
    label: "Applying",
    container: "bg-accent-soft",
    text: "text-accent",
  },
  failed: { label: "Failed", container: "bg-danger-soft", text: "text-danger" },
  rejected: {
    label: "Rejected",
    container: "bg-surface-secondary",
    text: "text-muted",
  },
}

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
}): string {
  if (spec.resolverKind === "role") {
    return `approved by the ${spec.resolverRole ?? "chosen"} role`
  }
  if (spec.resolverKind === "user") return "approved by a chosen member"
  return "approved by any member"
}

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

function CopyUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      className="flex-row items-center gap-two rounded-lor-sm bg-surface-secondary px-two py-two active:opacity-70"
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

function OperationItem({
  op,
  operations,
  channelNames,
  applied,
  isLast,
  showSecretInputs,
  secretValues,
  onSecretChange,
}: {
  op: ProposalOperation
  operations: ProposalOperation[]
  channelNames: Map<string, string>
  applied: boolean
  isLast: boolean
  showSecretInputs: boolean
  secretValues: Record<string, string>
  onSecretChange: (key: string, value: string) => void
}) {
  const router = useRouter()
  const [muted, accent, danger, fieldPlaceholder] = useThemeColor([
    "muted",
    "accent",
    "danger",
    "field-placeholder",
  ])
  const { title, details } = opView(op, operations, channelNames)
  const spec = op.spec
  const secretNames =
    spec.op === "create_custom_tool" ? spec.requiredSecrets : []
  const hasPanel =
    details.length > 0 ||
    spec.op === "update_instructions" ||
    (showSecretInputs && secretNames.length > 0) ||
    Boolean(op.error) ||
    Boolean(op.result?.url) ||
    Boolean(op.result?.setupNote) ||
    Boolean(op.result?.resourceId && spec.op === "create_channel")

  const indicator = op.error
    ? { container: "bg-danger-soft", color: danger, icon: AlertCircleIcon }
    : applied
      ? { container: "bg-accent-soft", color: accent, icon: Tick02Icon }
      : {
          container: "border border-border bg-surface",
          color: muted,
          // Unknown kind (newer server): generic glyph, not a crash.
          icon: (OP_ICONS[op.kind] as IconSvg | undefined) ?? SparklesIcon,
        }

  return (
    <View className="flex-row gap-three">
      <View className="items-center">
        <View
          className={`size-6 items-center justify-center rounded-full ${indicator.container}`}
        >
          <HugeiconsIcon
            color={indicator.color}
            icon={indicator.icon}
            size={13}
          />
        </View>
        {!isLast ? (
          <View className="my-one w-[2px] flex-1 rounded-full bg-border" />
        ) : null}
      </View>

      <View className={`min-w-0 flex-1 ${isLast ? "" : "pb-three"}`}>
        <Text className="pt-[2px] text-[15px] font-semibold leading-5 text-foreground">
          {title}
        </Text>
        {hasPanel ? (
          <View className="mt-one gap-two rounded-lor-sm border border-border bg-surface px-three py-two">
            {details.map((line) => (
              <Text
                className="text-sm leading-5 text-muted"
                key={line}
                numberOfLines={3}
              >
                {line}
              </Text>
            ))}
            {spec.op === "update_instructions" ? (
              <Text className="font-mono text-xs text-muted" numberOfLines={10}>
                {spec.content}
              </Text>
            ) : null}
            {showSecretInputs
              ? secretNames.map((name) => (
                  <View className="gap-one" key={name}>
                    <Text className="font-mono text-xs text-muted">{name}</Text>
                    <TextInput
                      autoCapitalize="none"
                      autoComplete="off"
                      className="rounded-lor-sm border border-border bg-surface-secondary px-two py-two text-sm text-foreground"
                      onChangeText={(value) =>
                        onSecretChange(`${op.position}:${name}`, value)
                      }
                      placeholder="Paste the secret (optional)"
                      placeholderTextColor={fieldPlaceholder}
                      secureTextEntry
                      value={secretValues[`${op.position}:${name}`] ?? ""}
                    />
                  </View>
                ))
              : null}
            {showSecretInputs && secretNames.length > 0 ? (
              <Text className="text-[11px] text-muted">
                Optional — added encrypted, never shown to Merlin.
              </Text>
            ) : null}
            {op.error ? (
              <Text className="text-sm text-danger">{op.error}</Text>
            ) : null}
            {op.result?.resourceId && spec.op === "create_channel" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/channel/[channelId]",
                    params: { channelId: op.result?.resourceId ?? "" },
                  } as never)
                }
              >
                <Text className="text-sm font-medium text-accent">
                  Open #{spec.name}
                </Text>
              </Pressable>
            ) : null}
            {op.result?.url ? <CopyUrlRow url={op.result.url} /> : null}
            {op.result?.setupNote ? (
              <View className="flex-row items-start gap-one rounded-lor-sm bg-warning-soft px-two py-one">
                <Text className="text-xs leading-4 text-warning-soft-foreground">
                  {op.result.setupNote}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  )
}

export function ProposalCard({ message }: { message: Message }) {
  const proposal = useMessageProposal(message.channelId, message.id)
  if (!proposal) {
    return (
      <View className="mt-one max-w-[420px] rounded-lor-sm border border-border bg-surface px-three py-two">
        <Text className="text-sm leading-5 text-muted" numberOfLines={2}>
          {message.content ?? "Workspace changes"}
        </Text>
      </View>
    )
  }
  return <ProposalCardBody proposal={proposal} />
}

function ProposalCardBody({ proposal }: { proposal: ChannelProposal }) {
  const { workspace } = useWorkspace()
  const approve = useApproveProposal(proposal.channelId)
  const reject = useRejectProposal(proposal.channelId)
  const canResolve = useCanResolveProposal(proposal.requiredPermissions)
  const members = useWorkspaceMembers(workspace?.slug ?? "")
  const [muted] = useThemeColor(["muted"])
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState("")

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
    members.members.find((m) => m.userId === proposal.resolvedByUserId)?.name ??
    null

  const isPending = proposal.status === "pending"
  const isApplied = proposal.status === "applied"
  const busy = approve.isPending || reject.isPending
  const opCount = proposal.operations.length
  const meta =
    proposal.status === "applied" ? null : STATUS_META[proposal.status]
  const sourceHosts = [
    ...new Set(
      proposal.evidence
        .filter((item) => item.kind === "url")
        .map((item) => {
          try {
            return new URL(item.ref).hostname.replace(/^www\./, "")
          } catch {
            return null
          }
        })
        .filter((host): host is string => Boolean(host))
    ),
  ]

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

  return (
    <View className="mt-one max-w-[520px]">
      <View className="flex-row items-start justify-between gap-two">
        <Text className="text-[15px] font-semibold leading-5 text-foreground">
          {opCount === 1 ? "Workspace change" : `${opCount} workspace changes`}
        </Text>
        {meta ? (
          <View className={`rounded-full px-two py-one ${meta.container}`}>
            <Text className={`text-[11px] font-semibold ${meta.text}`}>
              {meta.label}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        className="mt-one text-sm leading-5 text-muted"
        numberOfLines={isPending ? undefined : 2}
      >
        {proposal.rationale}
      </Text>

      <View className="mt-three">
        {proposal.operations.map((op, index) => (
          <OperationItem
            applied={isApplied}
            channelNames={channelNames}
            isLast={index === proposal.operations.length - 1}
            key={op.id}
            onSecretChange={(key, value) =>
              setSecretValues((prev) => ({ ...prev, [key]: value }))
            }
            op={op}
            operations={proposal.operations}
            secretValues={secretValues}
            showSecretInputs={isPending && canResolve}
          />
        ))}
      </View>

      {sourceHosts.length > 0 ? (
        <View className="mt-two flex-row flex-wrap items-center gap-one">
          <Text className="text-xs text-muted">Sources</Text>
          {sourceHosts.map((host) => (
            <View
              className="flex-row items-center gap-one rounded-full border border-border bg-surface px-two py-one"
              key={host}
            >
              <HugeiconsIcon color={muted} icon={Link01Icon} size={11} />
              <Text className="text-xs font-medium text-muted">{host}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {isApplied && resolverName ? (
        <Text className="mt-two text-xs text-muted">
          Approved by {resolverName}
        </Text>
      ) : null}
      {proposal.status === "rejected" ? (
        <Text className="mt-two text-xs text-muted">
          {resolverName ? `Rejected by ${resolverName}` : "Rejected"}
          {proposal.resolutionNote ? ` — ${proposal.resolutionNote}` : ""}
        </Text>
      ) : null}
      {proposal.status === "failed" && proposal.resolutionNote ? (
        <Text className="mt-two text-xs text-danger">
          {proposal.resolutionNote}
        </Text>
      ) : null}

      {isPending ? (
        canResolve ? (
          rejecting ? (
            <View className="mt-three gap-two">
              <TextInput
                className="min-h-16 rounded-lor-sm border border-border bg-surface px-two py-two text-sm text-foreground"
                multiline
                onChangeText={setNote}
                placeholder="Why not? Merlin revises from this note (optional)"
                placeholderTextColor={muted}
                value={note}
              />
              <View className="flex-row gap-two">
                <Button
                  isDisabled={busy}
                  onPress={() =>
                    reject.mutate(
                      {
                        proposalId: proposal.id,
                        note: note.trim() || undefined,
                      },
                      { onSuccess: () => setRejecting(false) }
                    )
                  }
                  size="sm"
                  variant="danger"
                >
                  {reject.isPending ? "Working…" : "Reject"}
                </Button>
                <Button
                  isDisabled={busy}
                  onPress={() => setRejecting(false)}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </View>
            </View>
          ) : (
            <View className="mt-three flex-row gap-two">
              <Button isDisabled={busy} onPress={onApprove} size="sm">
                {approve.isPending ? "Working…" : "Approve"}
              </Button>
              <Button
                isDisabled={busy}
                onPress={() => setRejecting(true)}
                size="sm"
                variant="secondary"
              >
                Reject
              </Button>
            </View>
          )
        ) : (
          <Text className="mt-two text-xs text-muted">
            Waiting for someone with permission to approve.
          </Text>
        )
      ) : null}
    </View>
  )
}
