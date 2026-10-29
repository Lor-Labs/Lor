import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

export function useBetaAvailability() {
  return useQuery({
    queryKey: ["beta-availability"],
    staleTime: 15_000,
    queryFn: async () => {
      const response = await apiClient.beta.availability.$get()
      if (!response.ok)
        throw new Error("Signup availability is temporarily unavailable")
      return response.json()
    },
  })
}
