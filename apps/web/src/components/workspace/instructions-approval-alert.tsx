import { Scroll01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "@repo/ui/components/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

// Compact sidebar banner for workspace owner/admins while an agent-proposed
// instructions change sits unapproved. Shares the settings section's query
// key, so approving/rejecting there dismisses this instantly.
export function InstructionsApprovalAlert({
  workspaceSlug,
  onReview,
}: {
  workspaceSlug: string
  onReview: () => void
}) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ["workspace-instructions", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].instructions.$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load instructions")
      return res.json()
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
  const canManage = data?.canManage ?? false

  // Live feedback the moment Merlin files a proposal: refresh the shared
  // query (pops this banner) and toast the admins who can act on it.
  useEffect(() => {
    if (!socket) return
    const onProposal = () => {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-instructions"],
      })
      if (canManage) {
        toast("Merlin proposed new workspace instructions", {
          description: "Review and approve them in settings.",
          action: { label: "Review", onClick: onReview },
        })
      }
    }
    socket.on("instructions:proposal", onProposal)
    return () => {
      socket.off("instructions:proposal", onProposal)
    }
  }, [socket, queryClient, canManage, onReview])

  if (!data?.canManage || !data.pending) return null

  return (
    <button
      type="button"
      onClick={onReview}
      className="flex w-full cursor-pointer items-start gap-2 rounded-md border border-merlin/30 bg-merlin/10 px-2 py-1.5 text-left transition-colors hover:bg-merlin/15"
    >
      <HugeiconsIcon
        icon={Scroll01Icon}
        className="mt-0.5 size-3.5 shrink-0 text-merlin"
        strokeWidth={2}
      />
      <span className="min-w-0 text-xs leading-snug">
        <span className="font-medium">Merlin proposed new instructions</span>
        <span className="block text-muted-foreground">
          Review and approve in settings
        </span>
      </span>
    </button>
  )
}
