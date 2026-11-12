import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { RefreshControl } from "react-native"

// A list's pull to refresh, as its `refreshControl`. The spinner shows for a
// pull only: tied to the query's own fetching state it would also flash each
// time the list refetches by itself (on focus, on reconnect).
export function usePullToRefresh(refresh: () => Promise<unknown>) {
  const accent = useThemeColor("accent")
  const [refreshing, setRefreshing] = useState(false)
  return (
    <RefreshControl
      colors={[accent]}
      onRefresh={() => {
        setRefreshing(true)
        void refresh()
          .catch(() => undefined)
          .finally(() => setRefreshing(false))
      }}
      refreshing={refreshing}
      tintColor={accent}
    />
  )
}
