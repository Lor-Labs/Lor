import { focusManager, QueryClient } from "@tanstack/react-query"
import { AppState } from "react-native"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
    },
  },
})

// React Query can't observe window focus on native — drive it from AppState.
export function subscribeQueryFocus() {
  const subscription = AppState.addEventListener("change", (status) => {
    focusManager.setFocused(status === "active")
  })
  return () => subscription.remove()
}
