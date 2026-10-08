import { authClient } from "@repo/auth/client"
import { Switch } from "@repo/ui/components/switch"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { companyEmailDomain } from "@repo/utils/domain"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useId } from "react"
import { apiClient } from "@/lib/api-client"

// Join by email domain: anyone with a verified email on the domain sees the
// workspace at onboarding and joins without an invite. The server only lets
// an admin open it to their own verified company domain.
export function DomainJoinSwitch({
  workspace,
  branch = false,
  className,
}: {
  workspace: { slug: string; joinDomain?: string | null }
  /**
   * Sits under the setup group, outside its fill, joined to the invite
   * step's icon by a branch line.
   */
  branch?: boolean
  className?: string
}) {
  const queryClient = useQueryClient()
  const labelId = useId()
  const { data: session } = authClient.useSession()
  const ownDomain = session?.user.emailVerified
    ? companyEmailDomain(session.user.email)
    : null
  const domain = workspace.joinDomain ?? ownDomain

  const update = useMutation({
    mutationFn: async (joinDomain: string | null) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].$patch({
        param: { workspaceSlug: workspace.slug },
        json: { joinDomain },
      })
      if (!res.ok) throw new Error("Failed to update join domain")
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
    onError: () => toast.error("Couldn't update who can join"),
  })

  if (!domain) return null
  const checked = update.isPending
    ? update.variables !== null
    : !!workspace.joinDomain

  return (
    <div
      className={cn(
        "flex items-center gap-3",
        branch ? "relative pt-3 pr-4 pl-[68px]" : "py-3",
        className
      )}
    >
      {branch && (
        // Starts at the invite icon's bottom edge (12px up, inside the
        // group), drops out of the group, and curves into this row's middle.
        // x = the group's 16px padding + half the 40px icon tile.
        <span
          aria-hidden
          className="pointer-events-none absolute -top-3 bottom-[calc(50%-6px)] left-[35.5px] w-6 rounded-bl-[10px] border-b border-l border-border"
        />
      )}
      <div className="min-w-0 flex-1">
        <p id={labelId} className="text-sm font-medium">
          Anyone with an @{domain} email can join
        </p>
        <p className="truncate text-sm text-muted-foreground">
          They'll see it when they sign up. No invite needed.
        </p>
      </div>
      <Switch
        aria-labelledby={labelId}
        checked={checked}
        disabled={update.isPending || (!checked && !ownDomain)}
        onCheckedChange={(next) => update.mutate(next ? ownDomain : null)}
      />
    </div>
  )
}
