import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useDMs() {
  const query = useQuery({
    queryKey: ["dms"],
    queryFn: async () => {
      const response = await api.v1.dms.$get({ query: {} })
      if (!response.ok) throw new Error("Could not load conversations")
      return response.json()
    },
  })

  return {
    dms: query.data?.data ?? [],
    isLoading: query.isPending,
    error: query.data ? null : (query.error?.message ?? null),
    refetch: query.refetch,
  }
}

export function useDM(dmId: string) {
  const enabled = Boolean(dmId)
  const query = useQuery({
    queryKey: ["dms", dmId],
    enabled,
    queryFn: async () => {
      const response = await api.v1.dms[":dmId"].$get({ param: { dmId } })
      if (!response.ok) throw new Error("Could not load this conversation")
      return response.json()
    },
  })

  return {
    dm: query.data ?? null,
    isLoading: enabled && query.isPending,
    error: query.data ? null : (query.error?.message ?? null),
    refetch: query.refetch,
  }
}
