import { normalizeDomain } from "@repo/utils/domain"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"

// Longer than the favicon debounce: each distinct domain costs a lookup, so
// wait until the user has likely stopped typing.
const LOOKUP_DEBOUNCE_MS = 600

// Company prefill for onboarding. Starts at mount when the website is already
// known (company email), so the result is usually ready before the user
// reaches the form.
export function useCompanySite(website: string) {
  const [domain, setDomain] = useState(() => normalizeDomain(website))

  useEffect(() => {
    const id = setTimeout(
      () => setDomain(normalizeDomain(website)),
      LOOKUP_DEBOUNCE_MS
    )
    return () => clearTimeout(id)
  }, [website])

  const query = useQuery({
    queryKey: ["onboarding", "site", domain],
    queryFn: async () => {
      if (!domain) return null
      const res = await apiClient.v1.onboarding.site.$get({
        query: { domain },
      })
      return res.ok ? res.json() : null
    },
    enabled: domain !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  return {
    domain,
    site: query.data ?? null,
    isReading: domain !== null && query.isFetching,
  }
}
