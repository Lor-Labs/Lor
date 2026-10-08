import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
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
  // Several mounts can want the same hint (one per Lor reply); the first
  // to become eligible gets it.
  activeInstance: string | null
  isDismissed: (key: HintKey) => boolean
  dismiss: (key: HintKey) => void
  setEligible: (key: HintKey, instance: string, eligible: boolean) => void
}

const HintsContext = createContext<HintsContextValue | null>(null)

function isHintKey(value: string): value is HintKey {
  return (HINT_PRIORITY as readonly string[]).includes(value)
}

export function HintsProvider({ children }: { children: ReactNode }) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const [eligible, setEligibleMap] = useState<
    ReadonlyMap<HintKey, readonly string[]>
  >(() => new Map())

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

  const setEligible = useCallback(
    (key: HintKey, instance: string, value: boolean) => {
      setEligibleMap((prev) => {
        const instances = prev.get(key) ?? []
        if (instances.includes(instance) === value) return prev
        const next = new Map(prev)
        next.set(
          key,
          value
            ? [...instances, instance]
            : instances.filter((id) => id !== instance)
        )
        return next
      })
    },
    []
  )

  const activeKey =
    HINT_PRIORITY.find(
      (key) => (eligible.get(key)?.length ?? 0) > 0 && !isDismissed(key)
    ) ?? null
  const activeInstance = activeKey
    ? (eligible.get(activeKey)?.[0] ?? null)
    : null

  const value = useMemo(
    () => ({ activeKey, activeInstance, isDismissed, dismiss, setEligible }),
    [activeKey, activeInstance, isDismissed, dismiss, setEligible]
  )

  return <HintsContext.Provider value={value}>{children}</HintsContext.Provider>
}

// `eligible`: the hint's own condition holds right now. `show` is true only
// for the one hint that wins the slot.
export function useHint(key: HintKey, eligible: boolean) {
  const context = useContext(HintsContext)
  const instance = useId()
  const setEligible = context?.setEligible
  const dismissKey = context?.dismiss

  useEffect(() => {
    if (!setEligible) return
    setEligible(key, instance, eligible)
    return () => setEligible(key, instance, false)
  }, [setEligible, key, instance, eligible])

  const dismiss = useCallback(() => dismissKey?.(key), [dismissKey, key])

  return {
    show: context?.activeKey === key && context.activeInstance === instance,
    dismissed: context ? context.isDismissed(key) : true,
    dismiss,
  }
}
