import { focusManager, QueryClient } from "@tanstack/react-query"
import { AppState } from "react-native"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
    },
  },
})

// A channel's details and latest messages seed its next visit (and the
// warm-up in use-prefetch-channels), so they stay for the app's life instead
// of the 5-minute default for caches no screen is using.
queryClient.setQueryDefaults(["channel"], { gcTime: Number.POSITIVE_INFINITY })
queryClient.setQueryDefaults(["messages"], {
  gcTime: Number.POSITIVE_INFINITY,
})

// React Query can't observe window focus on native — drive it from AppState.
export function subscribeQueryFocus() {
  const subscription = AppState.addEventListener("change", (status) => {
    focusManager.setFocused(status === "active")
  })
  return () => subscription.remove()
}
