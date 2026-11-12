import { useFocusEffect } from "expo-router"
import { useCallback, useState } from "react"

// The list row that opened the screen now on top. It stays highlighted while
// that screen covers the list and fades once the list has focus again, so
// coming back (a swipe back especially) shows where you were, as a native
// list does. Pass the id to the row's `selected`; call `open` as it navigates.
export function useOpenedRow() {
  const [openedId, setOpenedId] = useState<string | null>(null)
  useFocusEffect(
    useCallback(() => {
      setOpenedId(null)
    }, [])
  )
  return [openedId, setOpenedId] as const
}
