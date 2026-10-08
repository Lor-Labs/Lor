import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

// Product hints (reference/onboarding.md, Hints). Highest priority first:
// when several are eligible at once, only the first one shows.
const HINT_PRIORITY = [
  "lor_intro",
  "channels_intro",
  "lor_reply",
  "voice_intro",
  "connectors_intro",
] as const

export type HintKey = (typeof HINT_PRIORITY)[number]

const hintsQueryKey = ["hints"] as const

type HintsContextValue = {
  activeKey: HintKey | null
  isDismissed: (key: HintKey) => boolean
  dismiss: (key: HintKey) => void
  setEligible: (key: HintKey, eligible: boolean) => void
}

const HintsContext = createContext<HintsContextValue | null>(null)

function isHintKey(value: string): value is HintKey {
  return (HINT_PRIORITY as readonly string[]).includes(value)
}

export function HintsProvider({ children }: { children: ReactNode }) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const [eligible, setEligibleKeys] = useState<ReadonlySet<HintKey>>(
    () => new Set()
  )

  const { data: dismissed } = useQuery({
    queryKey: hintsQueryKey,
    queryFn: async (): Promise<HintKey[]> => {
      const res = await apiClient.v1.hints.$get()
      if (!res.ok) throw new Error("Failed to load hints")
      return (await res.json()).dismissed
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

  const addDismissed = useCallback(
    (key: HintKey) =>
      queryClient.setQueryData<HintKey[]>(hintsQueryKey, (prev = []) =>
        prev.includes(key) ? prev : [...prev, key]
      ),
    [queryClient]
  )

  useEffect(() => {
    if (!socket) return
    const onDismissed = ({ key }: { key: string }) => {
      if (isHintKey(key)) addDismissed(key)
    }
    socket.on("hint:dismissed", onDismissed)
    return () => {
      socket.off("hint:dismissed", onDismissed)
    }
  }, [socket, addDismissed])

  const { mutate } = useMutation({
    mutationFn: async (key: HintKey) => {
      const res = await apiClient.v1.hints[":key"].$put({ param: { key } })
      if (!res.ok) throw new Error("Failed to dismiss hint")
    },
    onMutate: addDismissed,
  })

  const isDismissed = useCallback(
    // Unknown until loaded: treat as dismissed so nothing flashes.
    (key: HintKey) => !dismissed || dismissed.includes(key),
    [dismissed]
  )

  const dismiss = useCallback(
    (key: HintKey) => {
      if (dismissed?.includes(key)) return
      mutate(key)
    },
    [dismissed, mutate]
  )

  const setEligible = useCallback((key: HintKey, value: boolean) => {
    setEligibleKeys((prev) => {
      if (prev.has(key) === value) return prev
      const next = new Set(prev)
      if (value) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const activeKey =
    HINT_PRIORITY.find((key) => eligible.has(key) && !isDismissed(key)) ?? null

  const value = useMemo(
    () => ({ activeKey, isDismissed, dismiss, setEligible }),
    [activeKey, isDismissed, dismiss, setEligible]
  )

  return <HintsContext.Provider value={value}>{children}</HintsContext.Provider>
}

// `eligible`: the hint's own condition holds right now. `show` is true only
// for the one hint that wins the slot.
export function useHint(key: HintKey, eligible: boolean) {
  const context = useContext(HintsContext)
  const setEligible = context?.setEligible
  const dismissKey = context?.dismiss

  useEffect(() => {
    if (!setEligible) return
    setEligible(key, eligible)
    return () => setEligible(key, false)
  }, [setEligible, key, eligible])

  const dismiss = useCallback(() => dismissKey?.(key), [dismissKey, key])

  return {
    show: context?.activeKey === key,
    dismissed: context ? context.isDismissed(key) : true,
    dismiss,
  }
}
