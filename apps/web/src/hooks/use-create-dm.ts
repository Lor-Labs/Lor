import { toast } from "@repo/ui/components/toast"
import { features } from "@repo/utils/features"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { apiClient } from "@/lib/api-client"
import type { GetDMResponse, ListDMsResponse } from "@/lib/api-types"

// The create call returns the DM the page needs, so it seeds the page's
// cache and the DM opens without fetching itself again.
export function useCreateDM() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (userIds: string[]) => {
      if (!features.directMessages)
        throw new Error("Direct messages are unavailable")
      const res = await apiClient.v1.dms.$post({
        json: { userIds },
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(
          "message" in body ? body.message : "Failed to create DM"
        )
      }
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.setQueryData<GetDMResponse>(["dms", data.dm.id], data.dm)
      void queryClient.invalidateQueries({ queryKey: ["dms"], exact: true })
      void navigate({ to: "/dms/$dmId", params: { dmId: data.dm.id } })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

// "Message" on a person: a one-to-one DM already in the list opens at once,
// with no request; otherwise it is created (or found) on the server.
export function useOpenDM() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const createDM = useCreateDM()

  const openDM = (userId: string) => {
    if (!features.directMessages) return
    const existing = queryClient
      .getQueryData<ListDMsResponse>(["dms"])
      ?.data.find(
        (dm) =>
          dm.type === "dm" &&
          dm.members.length === 1 &&
          dm.members[0]?.id === userId
      )
    if (existing) {
      void navigate({ to: "/dms/$dmId", params: { dmId: existing.id } })
      return
    }
    createDM.mutate([userId])
  }

  return { openDM, isPending: createDM.isPending }
}
