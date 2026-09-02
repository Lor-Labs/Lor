import { Button } from "@repo/ui/components/button"
import { Label } from "@repo/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Spinner } from "@repo/ui/components/spinner"
import { Switch } from "@repo/ui/components/switch"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useWorkspaceRoles } from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"
import { formatWorkspaceRole } from "@/lib/permissions"

type ApprovalPolicy = {
  id: string
  target: string
  resolverKind: "role" | "user" | "any_member"
  resolverRole: string | null
  resolverUserId: string | null
}

type ApprovalTarget = {
  key: string
  label: string
  description: string
  group: "capability" | "custom_tool" | "mcp_server"
}

const GROUP_TITLES: Record<ApprovalTarget["group"], string> = {
  capability: "Connector capabilities",
  custom_tool: "Custom tools",
  mcp_server: "MCP servers",
}

const GROUP_ORDER: ApprovalTarget["group"][] = [
  "capability",
  "custom_tool",
  "mcp_server",
]

// Resolver select values: any member, plus prefixed role/person entries so
// one select covers the whole spec (teams join later).
const KIND_ANY_MEMBER = "any_member"
const rolePrefix = "role:"
const userPrefix = "user:"

function resolverValue(policy: ApprovalPolicy): string {
  switch (policy.resolverKind) {
    case "role":
      return policy.resolverRole
        ? `${rolePrefix}${policy.resolverRole}`
        : KIND_ANY_MEMBER
    case "user":
      return policy.resolverUserId
        ? `${userPrefix}${policy.resolverUserId}`
        : KIND_ANY_MEMBER
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
    ...members.map((m) => ({
      value: `${userPrefix}${m.userId}`,
      label: m.name,
    })),
  ]

  const busy = upsert.isPending || remove.isPending

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          By default, Merlin acts on its own. Turn something on here and it will
          ask first — the action waits until someone approves it.
        </p>
        <p className="text-xs">
          You choose who can approve: anyone, a role, or a specific person.
        </p>
      </div>
      {GROUP_ORDER.map((group) => {
        const targets = data.targets.filter((t) => t.group === group)
        if (targets.length === 0) return null
        return (
          <div key={group} className="space-y-2">
            <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {GROUP_TITLES[group]}
            </h3>
            <div className="divide-y divide-border/60 rounded-lg border border-border">
              {targets.map((target) => {
                const policy = policyByTarget.get(target.key)
                const switchId = `approval-gate-${target.key}`
                return (
                  <div
                    key={target.key}
                    className="flex items-center justify-between gap-4 p-3"
                  >
                    <div className="min-w-0">
                      <Label htmlFor={switchId} className="text-sm">
                        {target.label}
                      </Label>
                      <p className="text-muted-foreground text-xs">
                        {target.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {policy && (
                        <Select
                          items={resolverItems}
                          value={resolverValue(policy)}
                          disabled={busy}
                          onValueChange={(value) => {
                            if (typeof value !== "string") return
                            upsert.mutate({
                              target: target.key,
                              ...valueToResolver(value),
                            })
                          }}
                        >
                          <SelectTrigger className="w-56" size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {resolverItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Switch
                        id={switchId}
                        checked={!!policy}
                        disabled={busy}
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
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
