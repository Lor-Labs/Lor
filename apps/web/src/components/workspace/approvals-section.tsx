import {
  ApiIcon,
  ArrowDown01Icon,
  CloudServerIcon,
  File02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  SettingsAction,
  SettingsDisclosureRow,
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { ToolChecklist } from "@/components/workspace/tool-picker"
import { useWorkspaceRoles } from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"
import type {
  ApprovalPoliciesResponse,
  ApprovalPolicy,
  ApprovalTarget,
} from "@/lib/api-types"
import { connectorLogo, isConnectorKey } from "@/lib/connector-ui"
import { formatWorkspaceRole } from "@/lib/permissions"

// Prefixes distinguish roles and people while sharing the saved resolver value.
const KIND_ANY_MEMBER = "any_member"
const rolePrefix = "role:"
const userPrefix = "user:"

type ResolverInput = {
  resolverKind: ApprovalPolicy["resolverKind"]
  resolverRole?: string
  resolverUserId?: string
}

type ResolverItem = { value: string; label: string }

type Service = {
  key: string
  label: string
  kind: ApprovalTarget["group"]
  connected: boolean
  targets: ApprovalTarget[]
}

function resolverValue(policy: ApprovalPolicy): string {
  switch (policy.resolverKind) {
    case "role":
      return policy.resolverRole
        ? `${rolePrefix}${policy.resolverRole}`
        : "role:unavailable"
    case "user":
      return policy.resolverUserId
        ? `${userPrefix}${policy.resolverUserId}`
        : "user:unavailable"
    default:
      return policy.resolverKind
  }
}

function valueToResolver(value: string): ResolverInput {
  if (value.startsWith(rolePrefix)) {
    return {
      resolverKind: "role",
      resolverRole: value.slice(rolePrefix.length),
    }
  }
  if (value.startsWith(userPrefix)) {
    return {
      resolverKind: "user",
      resolverUserId: value.slice(userPrefix.length),
    }
  }
  return { resolverKind: "any_member" }
}

function gatedSummary(gated: number, total: number): string {
  if (gated === 0) return "No approval needed"
  if (gated === total)
    return total === 1 ? "Needs approval" : `All ${total} need approval`
  return `${gated} of ${total} need approval`
}

function ServiceIcon({ service }: { service: Service }) {
  const className = "size-4"
  const [, id] = service.key.split(":")
  if (service.kind === "connector" && isConnectorKey(id)) {
    const Logo = connectorLogo(id)
    return <Logo className={className} />
  }
  if (service.key === "builtin:web") {
    const Logo = connectorLogo(null)
    return <Logo className={className} />
  }
  const icon =
    service.kind === "builtin"
      ? File02Icon
      : service.kind === "custom_tool"
        ? ApiIcon
        : CloudServerIcon
  return <HugeiconsIcon icon={icon} className={className} strokeWidth={2} />
}

function ResolverPicker({
  label,
  policy,
  resolverItems,
  personItems,
  onChange,
}: {
  label: string
  policy: ApprovalPolicy
  resolverItems: ResolverItem[]
  personItems: ResolverItem[]
  onChange: (value: string) => void
}) {
  const value = resolverValue(policy)
  // Keep departed members and deleted roles visible in the trigger.
  const current =
    [...resolverItems, ...personItems].find((item) => item.value === value)
      ?.label ?? "Unavailable approver"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Who can approve ${label}: ${current}`}
        render={
          <Button
            variant="ghost"
            size="sm"
            className="-my-1 max-w-40 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
          />
        }
      >
        <span className="truncate">{current}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-3.5 shrink-0"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {resolverItems.map((item) => (
            <DropdownMenuRadioItem key={item.value} value={item.value}>
              {item.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger inset>Specific person</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56 max-w-(--available-width)">
            <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
              {personItems.map((item) => (
                <DropdownMenuRadioItem
                  key={item.value}
                  value={item.value}
                  className="grid-cols-[.75rem_minmax(0,1fr)] [&>span:last-child]:truncate"
                >
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {personItems.length === 0 && (
              <DropdownMenuItem disabled>No members available</DropdownMenuItem>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// One service: the same Read/Write checklist as tool settings, where checked
// means "needs approval". Group checkboxes gate or clear a whole group.
function ServiceApprovals({
  service,
  policyByTarget,
  resolverItems,
  personItems,
  onSetRequired,
  onSetResolver,
}: {
  service: Service
  policyByTarget: Map<string, ApprovalPolicy>
  resolverItems: ResolverItem[]
  personItems: ResolverItem[]
  onSetRequired: (targets: string[], required: boolean) => void
  onSetResolver: (target: string, value: string) => void
}) {
  const keys = service.targets.map((target) => target.key)
  const gated = new Set(keys.filter((key) => policyByTarget.has(key)))
  return (
    <SettingsDisclosureRow
      icon={<ServiceIcon service={service} />}
      title={service.label}
      summary={gatedSummary(gated.size, keys.length)}
    >
      <ToolChecklist
        tools={service.targets.map((target) => ({
          name: target.key,
          label: target.label,
          description: target.description,
          readOnlyHint: target.readOnlyHint,
        }))}
        selected={gated}
        // Only built-in and connector catalogs declare reads for sure.
        providerHints={
          service.kind === "mcp_server" || service.kind === "custom_tool"
        }
        onChange={(next) => {
          onSetRequired(
            keys.filter((key) => next.has(key) && !gated.has(key)),
            true
          )
          onSetRequired(
            keys.filter((key) => !next.has(key) && gated.has(key)),
            false
          )
        }}
        rowAction={(tool) => {
          const policy = policyByTarget.get(tool.name)
          return (
            policy && (
              <ResolverPicker
                label={tool.label ?? tool.name}
                policy={policy}
                resolverItems={resolverItems}
                personItems={personItems}
                onChange={(value) => onSetResolver(tool.name, value)}
              />
            )
          )
        }}
      />
    </SettingsDisclosureRow>
  )
}

const approvalPoliciesQueryKey = (workspaceSlug: string) =>
  ["approval-policies", workspaceSlug] as const

export function ApprovalsSection({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string
  workspaceSlug: string
}) {
  const queryClient = useQueryClient()
  const queryKey = approvalPoliciesQueryKey(workspaceSlug)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "approval-policies"
      ].$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load approval policies")
      return res.json()
    },
  })

  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
  })
  const { data: customRoles } = useWorkspaceRoles(workspaceId)

  // Gates and approvers change optimistically; the server answer replaces the
  // cache when each request settles.
  const patchPolicies = async (
    update: (policies: ApprovalPolicy[]) => ApprovalPolicy[]
  ) => {
    await queryClient.cancelQueries({ queryKey })
    const previous =
      queryClient.getQueryData<ApprovalPoliciesResponse>(queryKey)
    if (previous)
      queryClient.setQueryData<ApprovalPoliciesResponse>(queryKey, {
        ...previous,
        policies: update(previous.policies),
      })
    return { previous }
  }
  const rollback = (
    context: { previous?: ApprovalPoliciesResponse } | undefined
  ) => {
    if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
  }

  const setResolver = useMutation({
    mutationFn: async (input: { target: string } & ResolverInput) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "approval-policies"
      ].$put({ param: { workspaceSlug }, json: input })
      if (!res.ok) throw new Error("Failed to save approval policy")
    },
    onMutate: (input) =>
      patchPolicies((policies) =>
        policies.map((policy) =>
          policy.target === input.target
            ? {
                ...policy,
                resolverKind: input.resolverKind,
                resolverRole: input.resolverRole ?? null,
                resolverUserId: input.resolverUserId ?? null,
              }
            : policy
        )
      ),
    onError: (_error, _input, context) => {
      rollback(context)
      toast.error("Couldn't change who can approve")
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })

  const setRequired = useMutation({
    mutationFn: async (input: { targets: string[]; required: boolean }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "approval-policies"
      ].bulk.$put({ param: { workspaceSlug }, json: input })
      if (!res.ok) throw new Error("Failed to update approval rules")
    },
    onMutate: (input) =>
      patchPolicies((policies) => {
        const targets = new Set(input.targets)
        if (!input.required)
          return policies.filter((policy) => !targets.has(policy.target))
        const existing = new Set(policies.map((policy) => policy.target))
        // New rules start with any member, as the server assigns.
        return [
          ...policies,
          ...input.targets
            .filter((target) => !existing.has(target))
            .map((target) => ({
              id: `pending:${target}`,
              target,
              resolverKind: "any_member" as const,
              resolverRole: null,
              resolverUserId: null,
            })),
        ]
      }),
    onError: (_error, _input, context) => {
      rollback(context)
      toast.error("Couldn't update the approval rules")
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn't load approval policies.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const policyByTarget = new Map(data.policies.map((p) => [p.target, p]))
  const members = (membersData?.members ?? []).filter((m) => !m.isBot)
  const resolverItems: ResolverItem[] = [
    { value: KIND_ANY_MEMBER, label: "Any member" },
    ...["admin", "member"].map((role) => ({
      value: `${rolePrefix}${role}`,
      label: `Role: ${formatWorkspaceRole(role)}`,
    })),
    ...(customRoles ?? []).map((role) => ({
      value: `${rolePrefix}${role.role}`,
      label: `Role: ${formatWorkspaceRole(role.role)}`,
    })),
  ]
  const personItems: ResolverItem[] = members.map((m) => ({
    value: `${userPrefix}${m.userId}`,
    label: m.name,
  }))

  const services: Service[] = []
  for (const target of data.targets) {
    if (target.group === "unavailable") continue
    let service = services.find((item) => item.key === target.groupKey)
    if (!service) {
      service = {
        key: target.groupKey,
        label: target.groupLabel,
        kind: target.group,
        connected: target.connected,
        targets: [],
      }
      services.push(service)
    }
    service.targets.push(target)
  }
  const unavailable = data.targets.filter(
    (target) => target.group === "unavailable"
  )

  const onSetRequired = (targets: string[], required: boolean) => {
    if (targets.length > 0) setRequired.mutate({ targets, required })
  }
  const onSetResolver = (target: string, value: string) =>
    setResolver.mutate({ target, ...valueToResolver(value) })
  const rows = (list: Service[]) =>
    list.map((service) => (
      <ServiceApprovals
        key={service.key}
        service={service}
        policyByTarget={policyByTarget}
        resolverItems={resolverItems}
        personItems={personItems}
        onSetRequired={onSetRequired}
        onSetResolver={onSetResolver}
      />
    ))
  const notConnected = services.filter((service) => !service.connected)

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Tools"
        description="Lor asks a person before using a checked tool. Owners can always approve."
      >
        <SettingsGroup>
          {rows(services.filter((service) => service.connected))}
        </SettingsGroup>
      </SettingsSection>
      {notConnected.length > 0 && (
        <SettingsSection
          title="Not connected"
          caption="Rules here apply once the service is connected."
        >
          <SettingsGroup>{rows(notConnected)}</SettingsGroup>
        </SettingsSection>
      )}
      {unavailable.length > 0 && (
        <SettingsSection
          title="Unavailable rules"
          caption="These tools no longer exist, so their rules do nothing."
        >
          <SettingsGroup>
            {unavailable.map((target) => (
              <div key={target.key} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {target.label}
                </span>
                <SettingsAction
                  onClick={() => onSetRequired([target.key], false)}
                >
                  Remove
                </SettingsAction>
              </div>
            ))}
          </SettingsGroup>
        </SettingsSection>
      )}
    </div>
  )
}
