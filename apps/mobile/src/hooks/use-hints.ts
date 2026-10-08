import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"

// The hints mobile shows (reference/onboarding.md, Hints). Each lives on its
// own screen, so mobile needs no one-at-a-time slot like web's provider.
type MobileHintKey = "lor_intro" | "voice_intro"

const hintsQueryKey = ["hints"] as const

export function useHint(key: MobileHintKey) {
  const socket = useSocket()
  const queryClient = useQueryClient()

  const { data: dismissed } = useQuery({
    queryKey: hintsQueryKey,
    queryFn: async (): Promise<string[]> => {
      const response = await api.v1.hints.$get()
      if (!response.ok) throw new Error("Could not load hints")
      return (await response.json()).dismissed
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

  const addDismissed = useCallback(
    (dismissedKey: string) =>
      queryClient.setQueryData<string[]>(hintsQueryKey, (prev = []) =>
        prev.includes(dismissedKey) ? prev : [...prev, dismissedKey]
      ),
    [queryClient]
  )

  useEffect(() => {
    if (!socket) return
    const onDismissed = ({ key: dismissedKey }: { key: string }) =>
      addDismissed(dismissedKey)
    socket.on("hint:dismissed", onDismissed)
    return () => {
      socket.off("hint:dismissed", onDismissed)
    }
  }, [socket, addDismissed])

  const { mutate } = useMutation({
    mutationFn: async (hintKey: MobileHintKey) => {
      const response = await api.v1.hints[":key"].$put({
        param: { key: hintKey },
      })
      if (!response.ok) throw new Error("Could not dismiss hint")
    },
    onMutate: addDismissed,
  })

  // Unknown until loaded: treat as dismissed so nothing flashes.
  const isDismissed = !dismissed || dismissed.includes(key)
  const dismiss = useCallback(() => {
    if (!isDismissed) mutate(key)
  }, [isDismissed, mutate, key])

  return { dismissed: isDismissed, dismiss }
}
