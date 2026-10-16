import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cleanToolDescription, toolGroups } from "@repo/connectors"
import { Button } from "@repo/ui/components/button"
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import { Label } from "@repo/ui/components/label"
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
import { SelectButton } from "@repo/ui/components/select"
import { Spinner } from "@repo/ui/components/spinner"
import { Switch } from "@repo/ui/components/switch"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DISCLOSURE_MOTION,
  SettingsGroup,
} from "@/components/workspace/settings-group"
import { useWorkspaceRoles } from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"
import type { ApprovalPolicy, ApprovalTarget } from "@/lib/api-types"
import { formatWorkspaceRole } from "@/lib/permissions"

// Prefixes distinguish roles and people while sharing the saved resolver value.
const KIND_ANY_MEMBER = "any_member"
const rolePrefix = "role:"
const userPrefix = "user:"

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

function valueToResolver(value: string): {
  resolverKind: ApprovalPolicy["resolverKind"]
  resolverRole?: string
  resolverUserId?: string
} {
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

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: approvalPoliciesQueryKey(workspaceSlug),
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

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: approvalPoliciesQueryKey(workspaceSlug),
    })

  const upsert = useMutation({
    mutationFn: async (input: {
      target: string
      resolverKind: ApprovalPolicy["resolverKind"]
      resolverRole?: string
      resolverUserId?: string
    }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "approval-policies"
      ].$put({ param: { workspaceSlug }, json: input })
      if (!res.ok) throw new Error("Failed to save approval policy")
      return res.json()
    },
    onSuccess: () => invalidate(),
    onError: () => toast.error("Couldn't save the approval policy"),
  })

  const remove = useMutation({
    mutationFn: async (policyId: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "approval-policies"
      ][":policyId"].$delete({ param: { workspaceSlug, policyId } })
      if (!res.ok) throw new Error("Failed to remove approval policy")
    },
    onSuccess: () => invalidate(),
    onError: () => toast.error("Couldn't turn the gate off"),
  })

  const bulk = useMutation({
    mutationFn: async (input: { targets: string[]; required: boolean }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "approval-policies"
      ].bulk.$put({ param: { workspaceSlug }, json: input })
      if (!res.ok) throw new Error("Failed to update approval rules")
    },
    onSuccess: () => invalidate(),
    onError: () => toast.error("Couldn't update the approval rules"),
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
  const resolverItems = [
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
  const personItems = members.map((m) => ({
    value: `${userPrefix}${m.userId}`,
    label: m.name,
  }))

  const busy = upsert.isPending || remove.isPending || bulk.isPending
  const byGroup = new Map<
    string,
    { label: string; kind: ApprovalTarget["group"]; targets: ApprovalTarget[] }
  >()
  for (const target of data.targets) {
    const group = byGroup.get(target.groupKey) ?? {
      label: target.groupLabel,
      kind: target.group,
      targets: [],
    }
    group.targets.push(target)
    byGroup.set(target.groupKey, group)
  }

  return (
    <div className="space-y-6">
      <p className="px-4 text-sm text-muted-foreground">
        Choose which tools need approval and who can approve them.
      </p>
      {[...byGroup].map(([groupKey, group]) => {
        const targets = group.targets
        const gated = targets.filter((target) =>
          policyByTarget.has(target.key)
        ).length
        const sections = toolGroups(
          targets,
          group.kind === "mcp_server" || group.kind === "custom_tool"
        )
        return (
          <Collapsible
            key={groupKey}
            defaultOpen={gated > 0 || group.kind === "builtin"}
            className="space-y-2"
          >
            <div className="flex items-center justify-between gap-3 px-4">
              <CollapsibleTrigger className="group flex min-w-0 cursor-pointer items-center gap-2 text-left text-sm font-medium">
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
                />
                <span className="truncate">{group.label}</span>
                <span className="shrink-0 text-xs font-normal text-muted-foreground">
                  {gated} of {targets.length} require approval
                </span>
              </CollapsibleTrigger>
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={busy}
                  render={<Button variant="ghost" size="sm" />}
                >
                  Bulk actions
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {group.kind !== "unavailable" && (
                    <>
                      <DropdownMenuItem
                        onClick={() =>
                          bulk.mutate({
                            targets: targets.map((target) => target.key),
                            required: true,
                          })
                        }
                      >
                        Require approval for all
                      </DropdownMenuItem>
                      {sections.length > 1 &&
                        sections.map((section) => (
                          <DropdownMenuItem
                            key={section.key}
                            onClick={() =>
                              bulk.mutate({
                                targets: section.tools.map(
                                  (target) => target.key
                                ),
                                required: true,
                              })
                            }
                          >
                            Require approval for {section.label.toLowerCase()}
                          </DropdownMenuItem>
                        ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem
                    disabled={gated === 0}
                    onClick={() =>
                      bulk.mutate({
                        targets: targets.map((target) => target.key),
                        required: false,
                      })
                    }
                  >
                    Turn off approval for all
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <CollapsiblePanel className={DISCLOSURE_MOTION}>
              <div className="space-y-4">
                {sections.map(({ key, label, tools: targets }) => (
                  <div key={key} className="space-y-2">
                    {sections.length > 1 && (
                      <p className="px-4 text-xs font-medium text-muted-foreground">
                        {label}
                      </p>
                    )}
                    <SettingsGroup>
                      {targets.map((target) => {
                        const policy = policyByTarget.get(target.key)
                        const switchId = `approval-gate-${target.key}`
                        const value = policy
                          ? resolverValue(policy)
                          : KIND_ANY_MEMBER
                        // Keep departed members and deleted roles visible in the trigger.
                        const resolverLabel =
                          [...resolverItems, ...personItems].find(
                            (item) => item.value === value
                          )?.label ?? "Unavailable resolver"
                        const setResolver = (nextValue: string) => {
                          upsert.mutate({
                            target: target.key,
                            ...valueToResolver(nextValue),
                          })
                        }
                        return (
                          <div key={target.key} className="space-y-2.5 py-3">
                            <div className="flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <Label htmlFor={switchId} className="text-sm">
                                  {target.label}
                                  {target.group === "mcp_server" &&
                                    target.readOnlyHint === true && (
                                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                                        Read only
                                      </span>
                                    )}
                                </Label>
                                <p
                                  className="line-clamp-2 text-sm text-muted-foreground"
                                  title={cleanToolDescription(
                                    target.description
                                  )}
                                >
                                  {cleanToolDescription(target.description)}
                                </p>
                              </div>
                              <Switch
                                id={switchId}
                                checked={!!policy}
                                disabled={
                                  busy ||
                                  (target.group === "unavailable" && !policy)
                                }
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    upsert.mutate({
                                      target: target.key,
                                      resolverKind: "any_member",
                                    })
                                  } else if (policy) {
                                    remove.mutate(policy.id)
                                  }
                                }}
                              />
                            </div>
                            {policy && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                  Who can approve
                                </span>
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    disabled={
                                      busy || target.group === "unavailable"
                                    }
                                    aria-label={`Who can approve ${target.label}: ${resolverLabel}`}
                                    render={
                                      <SelectButton
                                        className="w-56"
                                        size="sm"
                                      />
                                    }
                                  >
                                    {resolverLabel}
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    align="start"
                                    className="w-56"
                                  >
                                    <DropdownMenuRadioGroup
                                      value={value}
                                      onValueChange={setResolver}
                                    >
                                      {resolverItems.map((item) => (
                                        <DropdownMenuRadioItem
                                          key={item.value}
                                          value={item.value}
                                          disabled={
                                            busy ||
                                            target.group === "unavailable"
                                          }
                                        >
                                          {item.label}
                                        </DropdownMenuRadioItem>
                                      ))}
                                    </DropdownMenuRadioGroup>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger inset>
                                        Specific person
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent className="w-56 max-w-(--available-width)">
                                        <DropdownMenuRadioGroup
                                          value={value}
                                          onValueChange={setResolver}
                                        >
                                          {personItems.map((item) => (
                                            <DropdownMenuRadioItem
                                              key={item.value}
                                              value={item.value}
                                              disabled={
                                                busy ||
                                                target.group === "unavailable"
                                              }
                                              className="grid-cols-[.75rem_minmax(0,1fr)] [&>span:last-child]:truncate"
                                            >
                                              {item.label}
                                            </DropdownMenuRadioItem>
                                          ))}
                                        </DropdownMenuRadioGroup>
                                        {personItems.length === 0 && (
                                          <DropdownMenuItem disabled>
                                            No members available
                                          </DropdownMenuItem>
                                        )}
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </SettingsGroup>
                  </div>
                ))}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        )
      })}
    </div>
  )
}
